"""
Enterprise Skill Loader for OpenClaw Multi-Tenant Platform.

Loads skills from S3 based on tenant permissions and injects API keys
from SSM Parameter Store as environment variables.

Three-layer skill architecture (all zero-invasion to OpenClaw):
  Layer 1: Built-in skills (Docker image, always available)
  Layer 2: S3 hot-load skills (scripts, loaded at microVM startup)
  Layer 3: Pre-built skill bundles (tar.gz from S3, loaded at startup)

Usage:
  python skill_loader.py --tenant TENANT_ID --workspace /tmp/workspace \
    --bucket openclaw-tenants-xxx --stack openclaw-multitenancy --region us-east-1

Output:
  - Skills copied to {workspace}/skills/
  - /tmp/skill_env.sh with export KEY=VALUE lines for API key injection
"""

import argparse
import json
import logging
import os
import subprocess
import sys

import boto3
from botocore.exceptions import ClientError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def get_tenant_roles(ssm, stack_name, tenant_id, region):
    """Read tenant's role list from SSM permission profile."""
    try:
        resp = ssm.get_parameter(
            Name=f"/openclaw/{stack_name}/tenants/{tenant_id}/roles"
        )
        roles = [r.strip() for r in resp["Parameter"]["Value"].split(",")]
        logger.info("Tenant %s roles: %s", tenant_id, roles)
        return roles
    except ClientError:
        logger.info("No roles found for tenant %s, using default: [employee]", tenant_id)
        return ["employee"]


def load_skill_manifest(skill_dir):
    """Read skill.json manifest from a skill directory."""
    manifest_path = os.path.join(skill_dir, "skill.json")
    if not os.path.isfile(manifest_path):
        return None
    try:
        with open(manifest_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.warning("Failed to read manifest %s: %s", manifest_path, e)
        return None


def is_skill_allowed(manifest, tenant_roles):
    """Check if a skill is allowed for the tenant based on role permissions."""
    if not manifest:
        return True  # No manifest = no restrictions (backward compat)

    permissions = manifest.get("permissions", {})
    allowed_roles = permissions.get("allowedRoles", ["*"])
    blocked_roles = permissions.get("blockedRoles", [])

    # Check blocked first
    for role in tenant_roles:
        if role in blocked_roles:
            logger.info("Skill %s blocked for role %s", manifest.get("name"), role)
            return False

    # Check allowed
    if "*" in allowed_roles:
        return True
    for role in tenant_roles:
        if role in allowed_roles:
            return True

    logger.info("Skill %s not in allowedRoles for %s", manifest.get("name"), tenant_roles)
    return False


def load_layer2_skills(s3, bucket, stack_name, tenant_id, tenant_roles, workspace):
    """Load Layer 2 skills from S3 (script-level, no npm deps)."""
    skills_dir = os.path.join(workspace, "skills")
    os.makedirs(skills_dir, exist_ok=True)
    loaded = []

    # 1. Pull shared skills
    shared_prefix = "_shared/skills/"
    try:
        result = subprocess.run(
            ["aws", "s3", "sync",
             f"s3://{bucket}/{shared_prefix}", f"{skills_dir}/_shared_tmp/",
             "--quiet"],
            capture_output=True, text=True, timeout=30
        )
    except Exception as e:
        logger.warning("Failed to sync shared skills: %s", e)
        return loaded

    # 2. Filter by permissions and move to skills dir
    shared_tmp = os.path.join(skills_dir, "_shared_tmp")
    if os.path.isdir(shared_tmp):
        for skill_name in os.listdir(shared_tmp):
            skill_path = os.path.join(shared_tmp, skill_name)
            if not os.path.isdir(skill_path):
                continue
            manifest = load_skill_manifest(skill_path)
            if is_skill_allowed(manifest, tenant_roles):
                dest = os.path.join(skills_dir, skill_name)
                if not os.path.exists(dest):
                    os.rename(skill_path, dest)
                    loaded.append(skill_name)
                    logger.info("Layer 2 skill loaded: %s", skill_name)
            else:
                logger.info("Layer 2 skill filtered: %s", skill_name)
        # Cleanup tmp
        subprocess.run(["rm", "-rf", shared_tmp], capture_output=True)

    # 3. Pull tenant-specific skills
    tenant_prefix = f"{tenant_id}/skills/"
    try:
        subprocess.run(
            ["aws", "s3", "sync",
             f"s3://{bucket}/{tenant_prefix}", f"{skills_dir}/",
             "--quiet"],
            capture_output=True, text=True, timeout=30
        )
    except Exception as e:
        logger.warning("Failed to sync tenant skills: %s", e)

    return loaded


def load_layer3_bundles(s3_client, ssm, bucket, stack_name, workspace):
    """Load Layer 3 pre-built skill bundles from S3."""
    skills_dir = os.path.join(workspace, "skills")
    os.makedirs(skills_dir, exist_ok=True)
    loaded = []

    # Read skill catalog from SSM
    catalog_path = f"/openclaw/{stack_name}/skill-catalog/"
    try:
        resp = ssm.get_parameters_by_path(Path=catalog_path, Recursive=False)
        params = resp.get("Parameters", [])
    except ClientError:
        logger.info("No skill catalog found at %s", catalog_path)
        return loaded

    for param in params:
        skill_name = param["Name"].split("/")[-1]
        version = param["Value"]
        bundle_key = f"_shared/skill-bundles/skill-{skill_name}-{version}.tar.gz"

        local_tar = f"/tmp/skill-{skill_name}.tar.gz"
        try:
            s3_client.download_file(bucket, bundle_key, local_tar)
            subprocess.run(
                ["tar", "xzf", local_tar, "-C", skills_dir],
                capture_output=True, text=True, timeout=30, check=True
            )
            os.remove(local_tar)
            loaded.append(f"{skill_name}@{version}")
            logger.info("Layer 3 bundle loaded: %s@%s", skill_name, version)
        except ClientError:
            logger.warning("Bundle not found in S3: %s", bundle_key)
        except subprocess.CalledProcessError as e:
            logger.warning("Failed to extract bundle %s: %s", skill_name, e)
        except Exception as e:
            logger.warning("Failed to load bundle %s: %s", skill_name, e)

    return loaded


def inject_skill_keys(ssm, stack_name, workspace, env_file="/tmp/skill_env.sh"):
    """Read API keys from SSM and write export statements to env file."""
    skills_dir = os.path.join(workspace, "skills")
    env_lines = []
    injected = []

    # Scan all loaded skills for manifests
    if not os.path.isdir(skills_dir):
        return injected

    for skill_name in os.listdir(skills_dir):
        skill_path = os.path.join(skills_dir, skill_name)
        if not os.path.isdir(skill_path):
            continue
        manifest = load_skill_manifest(skill_path)
        if not manifest:
            continue

        required_env = manifest.get("requires", {}).get("env", [])
        if not required_env:
            continue

        # Try to load each required env var from SSM
        for env_var in required_env:
            ssm_path = f"/openclaw/{stack_name}/skill-keys/{skill_name}/{env_var}"
            try:
                resp = ssm.get_parameter(Name=ssm_path, WithDecryption=True)
                value = resp["Parameter"]["Value"]
                # Escape single quotes in value for shell safety
                safe_value = value.replace("'", "'\\''")
                env_lines.append(f"export {env_var}='{safe_value}'")
                injected.append(f"{skill_name}/{env_var}")
                logger.info("Injected key: %s/%s", skill_name, env_var)
            except ClientError:
                logger.warning("Key not found in SSM: %s", ssm_path)

    # Also load global skill keys (not tied to a specific skill)
    global_path = f"/openclaw/{stack_name}/skill-keys/_global/"
    try:
        resp = ssm.get_parameters_by_path(
            Path=global_path, Recursive=False, WithDecryption=True
        )
        for param in resp.get("Parameters", []):
            env_var = param["Name"].split("/")[-1]
            value = param["Value"]
            safe_value = value.replace("'", "'\\''")
            env_lines.append(f"export {env_var}='{safe_value}'")
            injected.append(f"_global/{env_var}")
            logger.info("Injected global key: %s", env_var)
    except ClientError:
        pass  # No global keys configured

    # Write env file
    with open(env_file, "w") as f:
        f.write("#!/bin/sh\n")
        f.write("# Auto-generated by skill_loader.py — do not edit\n")
        for line in env_lines:
            f.write(line + "\n")

    logger.info("Wrote %d env vars to %s", len(env_lines), env_file)
    return injected


def main():
    parser = argparse.ArgumentParser(description="Enterprise Skill Loader")
    parser.add_argument("--tenant", required=True, help="Tenant ID")
    parser.add_argument("--workspace", required=True, help="Workspace directory")
    parser.add_argument("--bucket", required=True, help="S3 bucket name")
    parser.add_argument("--stack", required=True, help="Stack name")
    parser.add_argument("--region", default="us-east-1", help="AWS region")
    args = parser.parse_args()

    ssm = boto3.client("ssm", region_name=args.region)
    s3 = boto3.client("s3", region_name=args.region)

    logger.info("=== Skill Loader START tenant=%s ===", args.tenant)

    # Get tenant roles for permission filtering
    roles = get_tenant_roles(ssm, args.stack, args.tenant, args.region)

    # Layer 2: S3 hot-load skills
    l2 = load_layer2_skills(s3, args.bucket, args.stack, args.tenant, roles, args.workspace)
    logger.info("Layer 2 loaded: %s", l2 if l2 else "none")

    # Layer 3: Pre-built skill bundles
    l3 = load_layer3_bundles(s3, ssm, args.bucket, args.stack, args.workspace)
    logger.info("Layer 3 loaded: %s", l3 if l3 else "none")

    # Inject API keys from SSM
    keys = inject_skill_keys(ssm, args.stack, args.workspace)
    logger.info("Keys injected: %d", len(keys))

    # Summary
    skills_dir = os.path.join(args.workspace, "skills")
    total = 0
    if os.path.isdir(skills_dir):
        total = len([d for d in os.listdir(skills_dir) if os.path.isdir(os.path.join(skills_dir, d))])
    logger.info("=== Skill Loader DONE: %d skills available ===", total)


if __name__ == "__main__":
    main()
