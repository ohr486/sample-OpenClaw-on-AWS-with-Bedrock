#!/bin/bash
# =============================================================================
# OpenClaw Enterprise — One-Command Deploy
#
# Usage:
#   cp .env.example .env        # first time: fill in your values
#   bash deploy.sh              # deploy everything
#   bash deploy.sh --skip-build # re-deploy without rebuilding Docker image
#   bash deploy.sh --skip-seed  # re-deploy without re-seeding DynamoDB
#
# What this script does:
#   1. Validates prerequisites (AWS CLI, Docker, Python, Node.js)
#   2. Deploys CloudFormation (VPC or reuses existing, EC2, ECR, S3, IAM)
#   3. Builds and pushes Agent Container image to ECR
#   4. Creates AgentCore Runtime
#   5. Seeds DynamoDB with org data and positions
#   6. Uploads SOUL templates and knowledge docs to S3
#   7. Prints access instructions
# =============================================================================
set -euo pipefail

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Load .env ─────────────────────────────────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo -e "${YELLOW}No .env file found.${NC}"
  echo "  Run:  cp enterprise/.env.example enterprise/.env"
  echo "  Then fill in at least: STACK_NAME, REGION, ADMIN_PASSWORD"
  echo ""
  error ".env file not found at $ENV_FILE"
fi
set -o allexport
# shellcheck source=.env
source "$ENV_FILE"
set +o allexport

# ── Override from CLI flags ────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_DOCKER_BUILD=true ;;
    --skip-seed)  SKIP_SEED=true ;;
  esac
done

# ── Defaults ──────────────────────────────────────────────────────────────────
STACK_NAME="${STACK_NAME:-openclaw-enterprise}"
REGION="${REGION:-us-east-1}"
MODEL="${MODEL:-global.amazon.nova-2-lite-v1:0}"
INSTANCE_TYPE="${INSTANCE_TYPE:-c7g.large}"
KEY_PAIR="${KEY_PAIR:-}"
EXISTING_VPC_ID="${EXISTING_VPC_ID:-}"
EXISTING_SUBNET_ID="${EXISTING_SUBNET_ID:-}"
CREATE_VPC_ENDPOINTS="${CREATE_VPC_ENDPOINTS:-false}"
ALLOWED_SSH_CIDR="${ALLOWED_SSH_CIDR:-127.0.0.1/32}"
# IMPORTANT: Table name must match STACK_NAME (IAM policy: table/${StackName})
DYNAMODB_TABLE="${DYNAMODB_TABLE:-$STACK_NAME}"
DYNAMODB_REGION="${DYNAMODB_REGION:-us-east-2}"
WORKSPACE_BUCKET_NAME="${WORKSPACE_BUCKET_NAME:-}"
SKIP_DOCKER_BUILD="${SKIP_DOCKER_BUILD:-false}"
SKIP_SEED="${SKIP_SEED:-false}"

# ── Validate required fields ──────────────────────────────────────────────────
[ -z "${ADMIN_PASSWORD:-}" ]  && error "ADMIN_PASSWORD is required. Set it in .env"

# If ExistingVpcId is set, ExistingSubnetId must also be set
if [ -n "$EXISTING_VPC_ID" ] && [ -z "$EXISTING_SUBNET_ID" ]; then
  error "EXISTING_SUBNET_ID is required when EXISTING_VPC_ID is set"
fi

# Auto-generate JWT_SECRET if not provided
if [ -z "${JWT_SECRET:-}" ]; then
  JWT_SECRET=$(openssl rand -hex 32)
  info "Generated JWT_SECRET (not stored to .env — will differ on redeploy)"
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) \
  || error "AWS credentials not configured. Run: aws configure"

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OpenClaw Enterprise — Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Stack:       $STACK_NAME"
echo "  Region:      $REGION"
echo "  Account:     $ACCOUNT_ID"
echo "  Model:       $MODEL"
echo "  Instance:    $INSTANCE_TYPE"
if [ -n "$EXISTING_VPC_ID" ]; then
echo "  VPC:         $EXISTING_VPC_ID (existing)"
echo "  Subnet:      $EXISTING_SUBNET_ID (existing)"
else
echo "  VPC:         (new — will be created)"
fi
echo "  VPC Endpoints: $CREATE_VPC_ENDPOINTS"
echo "  Skip build:  $SKIP_DOCKER_BUILD"
echo "  Skip seed:   $SKIP_SEED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: Prerequisites check ───────────────────────────────────────────────
info "[1/7] Checking prerequisites..."

CLI_VERSION=$(aws --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "0.0")
CLI_MAJOR=$(echo "$CLI_VERSION" | cut -d. -f1)
CLI_MINOR=$(echo "$CLI_VERSION" | cut -d. -f2)
if [ "$CLI_MAJOR" -lt 2 ] || { [ "$CLI_MAJOR" -eq 2 ] && [ "$CLI_MINOR" -lt 27 ]; }; then
  warn "AWS CLI $CLI_VERSION detected. bedrock-agentcore-control requires >= 2.27"
  warn "Run: pip install --upgrade awscli"
fi
success "AWS CLI $CLI_VERSION"

# Docker build runs on the gateway EC2 (ARM64 Graviton), not locally.
# No local Docker required.

# ── Step 2: CloudFormation ────────────────────────────────────────────────────
info "[2/7] Deploying CloudFormation stack..."

CFN_PARAMS="ParameterKey=WorkspaceBucketName,ParameterValue=${WORKSPACE_BUCKET_NAME}"
CFN_PARAMS="$CFN_PARAMS ParameterKey=OpenClawModel,ParameterValue=${MODEL}"
CFN_PARAMS="$CFN_PARAMS ParameterKey=InstanceType,ParameterValue=${INSTANCE_TYPE}"
CFN_PARAMS="$CFN_PARAMS ParameterKey=KeyPairName,ParameterValue=${KEY_PAIR}"
CFN_PARAMS="$CFN_PARAMS ParameterKey=AllowedSSHCIDR,ParameterValue=${ALLOWED_SSH_CIDR}"
CFN_PARAMS="$CFN_PARAMS ParameterKey=CreateVPCEndpoints,ParameterValue=${CREATE_VPC_ENDPOINTS}"
CFN_PARAMS="$CFN_PARAMS ParameterKey=ExistingVpcId,ParameterValue=${EXISTING_VPC_ID}"
CFN_PARAMS="$CFN_PARAMS ParameterKey=ExistingSubnetId,ParameterValue=${EXISTING_SUBNET_ID}"

# Try to create; if stack exists, do an update instead
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST")

if [ "$STACK_STATUS" = "DOES_NOT_EXIST" ]; then
  info "  Creating new stack (takes ~8 min)..."
  aws cloudformation create-stack \
    --stack-name "$STACK_NAME" \
    --template-body file://"$SCRIPT_DIR/clawdbot-bedrock-agentcore-multitenancy.yaml" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$REGION" \
    --parameters $CFN_PARAMS
  aws cloudformation wait stack-create-complete \
    --stack-name "$STACK_NAME" --region "$REGION"
else
  info "  Stack exists ($STACK_STATUS) — updating..."
  aws cloudformation update-stack \
    --stack-name "$STACK_NAME" \
    --template-body file://"$SCRIPT_DIR/clawdbot-bedrock-agentcore-multitenancy.yaml" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$REGION" \
    --parameters $CFN_PARAMS 2>/dev/null && \
  aws cloudformation wait stack-update-complete \
    --stack-name "$STACK_NAME" --region "$REGION" || \
  info "  No stack changes needed"
fi

# Get stack outputs
ECR_URI=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`MultitenancyEcrRepositoryUri`].OutputValue' --output text)
EXECUTION_ROLE_ARN=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`AgentContainerExecutionRoleArn`].OutputValue' --output text)
S3_BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`TenantWorkspaceBucketName`].OutputValue' --output text)
INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)

success "Stack ready — EC2: $INSTANCE_ID | S3: $S3_BUCKET"

# ── Step 3: Build and push Docker image ───────────────────────────────────────
# Always builds on the gateway EC2 (ARM64 Graviton, Docker pre-installed, fast ECR network).
# No local Docker required. Source code is packaged → S3 → EC2 build → ECR push.
if [ "$SKIP_DOCKER_BUILD" = "true" ]; then
  info "[3/7] Skipping Docker build (--skip-build)"
  IMAGE_COUNT=$(aws ecr describe-images --repository-name "${STACK_NAME}-multitenancy-agent" \
    --region "$REGION" --query 'length(imageDetails)' --output text 2>/dev/null || echo "0")
  if [ "$IMAGE_COUNT" = "0" ] || [ -z "$IMAGE_COUNT" ]; then
    warn "  ECR repo is empty — image must be pushed before creating the AgentCore Runtime."
    warn "  Re-run without --skip-build to trigger an EC2 build."
  else
    success "  ECR repo has $IMAGE_COUNT image(s)"
  fi
else
  info "[3/7] Building Agent Container on EC2 (~10-15 min, no local Docker needed)..."

  # Wait for EC2 to be SSM-reachable (it just launched from CloudFormation)
  info "  Waiting for EC2 SSM agent to become available..."
  for i in $(seq 1 30); do
    STATUS=$(aws ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
      --region "$REGION" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || echo "")
    [ "$STATUS" = "Online" ] && break
    sleep 10
  done
  [ "$STATUS" != "Online" ] && error "EC2 SSM agent not reachable after 5 min. Check instance status."

  # Package source (agent-container + exec-agent Dockerfiles + the whole enterprise dir for context)
  info "  Packaging source code → S3..."
  TARBALL="/tmp/agent-build-$$.tar.gz"
  COPYFILE_DISABLE=1 tar czf "$TARBALL" \
    -C "$SCRIPT_DIR/.." \
    enterprise/agent-container \
    enterprise/exec-agent 2>/dev/null || \
  tar czf "$TARBALL" \
    -C "$SCRIPT_DIR/.." \
    enterprise/agent-container \
    enterprise/exec-agent
  aws s3 cp "$TARBALL" "s3://${S3_BUCKET}/_build/agent-build.tar.gz" \
    --region "$REGION" --quiet
  rm -f "$TARBALL"
  success "  Source uploaded to S3"

  # Run docker build on EC2 via SSM
  info "  Running docker build on EC2 (this takes 10-15 min)..."
  BUILD_CMD_ID=$(aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --region "$REGION" \
    --timeout-seconds 1200 \
    --parameters "commands=[
      \"set -ex\",
      \"ACCOUNT_ID=\$(aws sts get-caller-identity --query Account --output text)\",
      \"ECR_URI=${ECR_URI}\",
      \"cd /tmp && rm -rf agent-build && mkdir agent-build && cd agent-build\",
      \"aws s3 cp s3://${S3_BUCKET}/_build/agent-build.tar.gz . --region ${REGION}\",
      \"tar xzf agent-build.tar.gz\",
      \"aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin \${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com\",
      \"docker build -f enterprise/agent-container/Dockerfile -t \${ECR_URI}:latest .\",
      \"docker push \${ECR_URI}:latest\",
      \"echo BUILD_AND_PUSH_COMPLETE\"
    ]" \
    --query 'Command.CommandId' --output text)

  info "  SSM command: $BUILD_CMD_ID — polling for completion..."
  # Poll every 30s up to 20 minutes
  for i in $(seq 1 40); do
    sleep 30
    BUILD_STATUS=$(aws ssm get-command-invocation \
      --command-id "$BUILD_CMD_ID" \
      --instance-id "$INSTANCE_ID" \
      --region "$REGION" \
      --query 'Status' --output text 2>/dev/null || echo "Pending")
    case "$BUILD_STATUS" in
      Success)
        success "  Docker build + push complete"
        break ;;
      Failed|Cancelled|TimedOut)
        STDERR=$(aws ssm get-command-invocation \
          --command-id "$BUILD_CMD_ID" --instance-id "$INSTANCE_ID" \
          --region "$REGION" --query 'StandardErrorContent' --output text 2>/dev/null | tail -20)
        error "Docker build failed ($BUILD_STATUS):\n$STDERR" ;;
      *)
        echo -n "." ;;
    esac
  done
  [ "$BUILD_STATUS" != "Success" ] && error "Docker build timed out after 20 min"
fi

# ── Step 4: AgentCore Runtime ─────────────────────────────────────────────────
info "[4/7] Creating AgentCore Runtime..."

EXISTING_RUNTIME=$(aws ssm get-parameter \
  --name "/openclaw/${STACK_NAME}/runtime-id" \
  --query Parameter.Value --output text \
  --region "$REGION" 2>/dev/null || echo "")

if [ -n "$EXISTING_RUNTIME" ] && [ "$EXISTING_RUNTIME" != "UNKNOWN" ]; then
  info "  Updating existing runtime $EXISTING_RUNTIME..."
  aws bedrock-agentcore-control update-agent-runtime \
    --agent-runtime-id "$EXISTING_RUNTIME" \
    --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${ECR_URI}:latest\"}}" \
    --role-arn "$EXECUTION_ROLE_ARN" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --region "$REGION" &>/dev/null || warn "  Runtime update failed — may need manual update in console"
  RUNTIME_ID="$EXISTING_RUNTIME"
else
  info "  Creating new runtime..."
  RUNTIME_ID=$(aws bedrock-agentcore-control create-agent-runtime \
    --agent-runtime-name "${STACK_NAME//-/_}_runtime" \
    --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${ECR_URI}:latest\"}}" \
    --role-arn "$EXECUTION_ROLE_ARN" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --protocol-configuration '{"serverProtocol":"HTTP"}' \
    --lifecycle-configuration '{"idleRuntimeSessionTimeout":300,"maxLifetime":3600}' \
    --environment-variables \
      STACK_NAME="${STACK_NAME}",AWS_REGION="${REGION}",S3_BUCKET="${S3_BUCKET}",\
BEDROCK_MODEL_ID="${MODEL}",DYNAMODB_TABLE="${DYNAMODB_TABLE}",DYNAMODB_REGION="${DYNAMODB_REGION}" \
    --region "$REGION" \
    --query 'agentRuntimeId' --output text)

  aws ssm put-parameter \
    --name "/openclaw/${STACK_NAME}/runtime-id" \
    --value "$RUNTIME_ID" --type String --overwrite \
    --region "$REGION" &>/dev/null
fi
success "Runtime: $RUNTIME_ID"

# Store runtime-id on the EC2 via SSM Parameter (so tenant_router can read it)
aws ssm put-parameter \
  --name "/openclaw/${STACK_NAME}/runtime-id" \
  --value "$RUNTIME_ID" --type String --overwrite \
  --region "$REGION" &>/dev/null

# ── Step 5: Upload SOUL templates and knowledge docs ──────────────────────────
info "[5/7] Uploading templates and knowledge to S3..."

export AWS_REGION="$REGION"
export S3_BUCKET

aws s3 sync "$SCRIPT_DIR/agent-container/templates/" \
  "s3://${S3_BUCKET}/_shared/templates/" --region "$REGION" --quiet

# Upload global SOUL if exists
GLOBAL_SOUL="$SCRIPT_DIR/agent-container/templates/default.md"
[ -f "$GLOBAL_SOUL" ] && \
  aws s3 cp "$GLOBAL_SOUL" "s3://${S3_BUCKET}/_shared/soul/global/SOUL.md" \
    --region "$REGION" --quiet

success "Templates uploaded to s3://${S3_BUCKET}/"

# ── Step 6: DynamoDB table + Seed ─────────────────────────────────────────────
# Create table if it doesn't exist (idempotent — no-op if already created)
TABLE_STATUS=$(aws dynamodb describe-table --table-name "$DYNAMODB_TABLE" \
  --region "$DYNAMODB_REGION" --query 'Table.TableStatus' --output text 2>/dev/null || echo "NOT_FOUND")
if [ "$TABLE_STATUS" = "NOT_FOUND" ]; then
  info "[6/7] Creating DynamoDB table $DYNAMODB_TABLE in $DYNAMODB_REGION..."
  aws dynamodb create-table \
    --table-name "$DYNAMODB_TABLE" \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
    --key-schema \
      AttributeName=PK,KeyType=HASH \
      AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes '[{
      "IndexName":"GSI1",
      "KeySchema":[
        {"AttributeName":"GSI1PK","KeyType":"HASH"},
        {"AttributeName":"GSI1SK","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }]' \
    --billing-mode PAY_PER_REQUEST \
    --region "$DYNAMODB_REGION" &>/dev/null
  info "  Waiting for table to become active..."
  aws dynamodb wait table-exists --table-name "$DYNAMODB_TABLE" --region "$DYNAMODB_REGION"
  success "DynamoDB table created: $DYNAMODB_TABLE"
else
  success "DynamoDB table exists: $DYNAMODB_TABLE ($TABLE_STATUS)"
fi

if [ "$SKIP_SEED" = "true" ]; then
  info "[6/7] Skipping DynamoDB seed (--skip-seed)"
else
  info "[6/7] Seeding DynamoDB..."
  SEED_DIR="$SCRIPT_DIR/admin-console/server"

  # Store ADMIN_PASSWORD in SSM (EC2 reads it on startup)
  aws ssm put-parameter \
    --name "/openclaw/${STACK_NAME}/admin-password" \
    --value "$ADMIN_PASSWORD" --type SecureString --overwrite \
    --region "$REGION" &>/dev/null
  success "  ADMIN_PASSWORD stored in SSM"

  if [ -n "$JWT_SECRET" ]; then
    aws ssm put-parameter \
      --name "/openclaw/${STACK_NAME}/jwt-secret" \
      --value "$JWT_SECRET" --type SecureString --overwrite \
      --region "$REGION" &>/dev/null
    success "  JWT_SECRET stored in SSM"
  fi

  cd "$SEED_DIR"
  AWS_REGION="$DYNAMODB_REGION" python3 seed_dynamodb.py --table "$DYNAMODB_TABLE" --region "$DYNAMODB_REGION" && \
    success "  Org data seeded (employees, positions, departments)"

  AWS_REGION="$DYNAMODB_REGION" python3 seed_roles.py --table "$DYNAMODB_TABLE" --region "$DYNAMODB_REGION" && \
    success "  Roles seeded (admin/manager/employee)"

  AWS_REGION="$DYNAMODB_REGION" python3 seed_settings.py --table "$DYNAMODB_TABLE" --region "$DYNAMODB_REGION" 2>/dev/null && \
    success "  Settings seeded" || warn "  seed_settings.py skipped (not found)"

  AWS_REGION="$REGION" S3_BUCKET="$S3_BUCKET" \
    python3 seed_knowledge_docs.py --bucket "$S3_BUCKET" --region "$REGION" && \
    success "  Knowledge docs uploaded"

  AWS_REGION="$REGION" S3_BUCKET="$S3_BUCKET" \
    python3 seed_workspaces.py --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null && \
    success "  Employee workspaces created" || warn "  seed_workspaces.py skipped"

  python3 seed_ssm_tenants.py \
    --region "$REGION" --stack "$STACK_NAME" && \
    success "  SSM tenant→position mappings created"
fi

# ── Step 7: Deploy Admin Console + Gateway Services to EC2 ────────────────────
info "[7/9] Building and deploying Admin Console..."

# Build frontend (requires Node.js locally)
if command -v npm &>/dev/null; then
  ADMIN_DIR="$SCRIPT_DIR/admin-console"
  cd "$ADMIN_DIR"
  npm install --silent 2>/dev/null
  npm run build 2>/dev/null
  cd "$SCRIPT_DIR/.."

  # Package and upload
  ADMIN_TAR="/tmp/admin-deploy-$$.tar.gz"
  COPYFILE_DISABLE=1 tar czf "$ADMIN_TAR" \
    -C "$SCRIPT_DIR/admin-console" dist server start.sh 2>/dev/null || \
  tar czf "$ADMIN_TAR" \
    -C "$SCRIPT_DIR/admin-console" dist server start.sh
  aws s3 cp "$ADMIN_TAR" "s3://${S3_BUCKET}/_deploy/admin-deploy.tar.gz" \
    --region "$REGION" --quiet
  rm -f "$ADMIN_TAR"
  success "  Admin Console packaged → S3"
else
  warn "  npm not found — skipping Admin Console build. Deploy manually (see README Step 4)."
fi

# Upload gateway service files
info "[8/9] Uploading Gateway services..."
GW_DIR="$SCRIPT_DIR/gateway"
if [ -d "$GW_DIR" ]; then
  for f in tenant_router.py bedrock_proxy_h2.js bedrock-proxy-h2.service tenant-router.service; do
    [ -f "$GW_DIR/$f" ] && aws s3 cp "$GW_DIR/$f" "s3://${S3_BUCKET}/_deploy/$f" --region "$REGION" --quiet
  done
  success "  Gateway files uploaded to S3"
else
  warn "  enterprise/gateway/ not found — skipping gateway upload"
fi

# ── Step 9: Configure EC2 — install everything via SSM ────────────────────────
info "[9/9] Configuring EC2 (Admin Console + Gateway + env)..."

# Get ECS outputs for /etc/openclaw/env
ECS_CLUSTER=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`AlwaysOnEcsClusterName`].OutputValue' --output text 2>/dev/null || echo "")
ECS_SUBNET=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`AlwaysOnSubnetId`].OutputValue' --output text 2>/dev/null || echo "")
ECS_SG=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`AlwaysOnTaskSecurityGroupId`].OutputValue' --output text 2>/dev/null || echo "")

EC2_CMD_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --region "$REGION" \
  --timeout-seconds 300 \
  --parameters "commands=[
    \"set -e\",
    \"# ── Write /etc/openclaw/env (all services read this) ──\",
    \"mkdir -p /etc/openclaw\",
    \"cat > /etc/openclaw/env << 'ENVEOF'
STACK_NAME=${STACK_NAME}
AWS_REGION=${REGION}
GATEWAY_REGION=${REGION}
DYNAMODB_TABLE=${DYNAMODB_TABLE}
DYNAMODB_REGION=${DYNAMODB_REGION}
S3_BUCKET=${S3_BUCKET}
GATEWAY_INSTANCE_ID=${INSTANCE_ID}
ECS_CLUSTER_NAME=${ECS_CLUSTER}
ECS_SUBNET_ID=${ECS_SUBNET}
ECS_TASK_SG_ID=${ECS_SG}
AGENTCORE_RUNTIME_ID=${RUNTIME_ID}
ENVEOF\",
    \"echo '[deploy] /etc/openclaw/env written'\",
    \"# ── Install Admin Console ──\",
    \"python3 -m venv /opt/admin-venv 2>/dev/null || true\",
    \"/opt/admin-venv/bin/pip install -q fastapi uvicorn boto3 requests python-multipart anthropic 2>/dev/null || true\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/admin-deploy.tar.gz /tmp/admin-deploy.tar.gz --region ${REGION} 2>/dev/null || true\",
    \"if [ -f /tmp/admin-deploy.tar.gz ]; then mkdir -p /opt/admin-console && tar xzf /tmp/admin-deploy.tar.gz -C /opt/admin-console && chown -R ubuntu:ubuntu /opt/admin-console /opt/admin-venv && chmod +x /opt/admin-console/start.sh; fi\",
    \"# ── Admin Console systemd ──\",
    \"cat > /etc/systemd/system/openclaw-admin.service << 'SVCEOF'
[Unit]
Description=OpenClaw Admin Console
After=network.target
[Service]
Type=simple
User=ubuntu
EnvironmentFile=/etc/openclaw/env
ExecStart=/opt/admin-console/start.sh
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
SVCEOF\",
    \"# ── Install Gateway services ──\",
    \"pip3 install --break-system-packages --upgrade boto3 botocore requests 2>/dev/null || true\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/tenant_router.py /home/ubuntu/tenant_router.py --region ${REGION} 2>/dev/null || true\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/bedrock_proxy_h2.js /home/ubuntu/bedrock_proxy_h2.js --region ${REGION} 2>/dev/null || true\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/tenant-router.service /etc/systemd/system/tenant-router.service --region ${REGION} 2>/dev/null || true\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/bedrock-proxy-h2.service /etc/systemd/system/bedrock-proxy-h2.service --region ${REGION} 2>/dev/null || true\",
    \"chown ubuntu:ubuntu /home/ubuntu/tenant_router.py /home/ubuntu/bedrock_proxy_h2.js 2>/dev/null || true\",
    \"# ── Start all services ──\",
    \"systemctl daemon-reload\",
    \"systemctl enable openclaw-admin tenant-router bedrock-proxy-h2 openclaw-gateway 2>/dev/null || true\",
    \"systemctl restart openclaw-admin tenant-router bedrock-proxy-h2 openclaw-gateway 2>/dev/null || true\",
    \"echo ALL_SERVICES_STARTED\"
  ]" \
  --output text --query 'Command.CommandId' 2>/dev/null) || warn "EC2 SSM command failed"

if [ -n "$EC2_CMD_ID" ]; then
  info "  SSM command: $EC2_CMD_ID — waiting for completion..."
  for i in $(seq 1 20); do
    sleep 5
    CMD_STATUS=$(aws ssm get-command-invocation \
      --command-id "$EC2_CMD_ID" --instance-id "$INSTANCE_ID" \
      --region "$REGION" --query 'Status' --output text 2>/dev/null || echo "Pending")
    case "$CMD_STATUS" in
      Success) success "  EC2 fully configured — all services started"; break ;;
      Failed)  warn "  EC2 config had errors (check SSM output)"; break ;;
      *) echo -n "." ;;
    esac
  done
fi

# ── Step 9.5: Allow ECS tasks to reach SSM VPC endpoint (if VPC endpoints exist) ──
SSM_EP_SG=$(aws ec2 describe-vpc-endpoints --region "$REGION" \
  --filters "Name=service-name,Values=com.amazonaws.${REGION}.ssm" \
  --query 'VpcEndpoints[0].Groups[0].GroupId' --output text 2>/dev/null || echo "")
if [ -n "$SSM_EP_SG" ] && [ "$SSM_EP_SG" != "None" ] && [ -n "$ECS_SG" ] && [ "$ECS_SG" != "None" ]; then
  aws ec2 authorize-security-group-ingress \
    --group-id "$SSM_EP_SG" --protocol tcp --port 443 \
    --source-group "$ECS_SG" --region "$REGION" 2>/dev/null && \
    success "  ECS→SSM VPC endpoint SG rule added" || true
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}Deployment Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Stack:      $STACK_NAME"
echo "  Runtime:    $RUNTIME_ID"
echo "  S3:         $S3_BUCKET"
echo "  EC2:        $INSTANCE_ID"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Wait ~5 min for EC2 to finish bootstrapping"
echo ""
echo "  2. Access Admin Console:"
echo "     aws ssm start-session --target $INSTANCE_ID --region $REGION \\"
echo "       --document-name AWS-StartPortForwardingSession \\"
echo "       --parameters 'portNumber=8099,localPortNumber=8099'"
echo "     → Open http://localhost:8099"
echo "     → Login: emp-jiade / password: (your ADMIN_PASSWORD)"
echo ""
echo "  3. Connect IM bots (one-time, in OpenClaw Gateway UI):"
echo "     aws ssm start-session --target $INSTANCE_ID --region $REGION \\"
echo "       --document-name AWS-StartPortForwardingSession \\"
echo "       --parameters 'portNumber=18789,localPortNumber=18789'"
echo "     → Open http://localhost:18789 → Channels → Add bot"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
