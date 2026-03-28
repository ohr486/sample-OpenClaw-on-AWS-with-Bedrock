"""Seed DynamoDB with knowledge base metadata."""
import argparse
import boto3

ORG = "ORG#acme"

def seed(table_name, region):
    ddb = boto3.resource("dynamodb", region_name=region)
    table = ddb.Table(table_name)
    items = []

    kbs = [
        {"id": "kb-policies", "name": "Company Policies", "scope": "global", "scopeName": "All Employees", "docCount": 12, "vectorCount": 3400, "sizeMB": "8.2", "status": "indexed", "lastUpdated": "2026-03-19T10:00:00Z", "accessibleBy": "All employees", "s3Prefix": "_shared/knowledge/company-policies/"},
        {"id": "kb-product", "name": "Product Documentation", "scope": "global", "scopeName": "All Employees", "docCount": 45, "vectorCount": 12800, "sizeMB": "32.5", "status": "indexed", "lastUpdated": "2026-03-20T08:00:00Z", "accessibleBy": "All employees", "s3Prefix": "_shared/knowledge/product-docs/"},
        {"id": "kb-onboarding", "name": "Onboarding Guide", "scope": "global", "scopeName": "All Employees", "docCount": 6, "vectorCount": 1200, "sizeMB": "3.1", "status": "indexed", "lastUpdated": "2026-03-15T00:00:00Z", "accessibleBy": "All employees", "s3Prefix": "_shared/knowledge/onboarding/"},
        {"id": "kb-arch", "name": "Architecture Standards", "scope": "department", "scopeName": "Engineering", "docCount": 8, "vectorCount": 2100, "sizeMB": "5.4", "status": "indexed", "lastUpdated": "2026-03-18T00:00:00Z", "accessibleBy": "Engineering dept", "s3Prefix": "_shared/knowledge/arch-standards/"},
        {"id": "kb-runbooks", "name": "Runbooks", "scope": "department", "scopeName": "Engineering", "docCount": 15, "vectorCount": 4200, "sizeMB": "11.3", "status": "indexed", "lastUpdated": "2026-03-17T00:00:00Z", "accessibleBy": "Engineering dept", "s3Prefix": "_shared/knowledge/runbooks/"},
        {"id": "kb-cases", "name": "Case Studies", "scope": "department", "scopeName": "Sales", "docCount": 12, "vectorCount": 3600, "sizeMB": "9.8", "status": "indexed", "lastUpdated": "2026-03-16T00:00:00Z", "accessibleBy": "Sales + SA positions", "s3Prefix": "_shared/knowledge/case-studies/"},
        {"id": "kb-finance", "name": "Financial Reports", "scope": "department", "scopeName": "Finance", "docCount": 8, "vectorCount": 1800, "sizeMB": "4.5", "status": "indexed", "lastUpdated": "2026-03-19T00:00:00Z", "accessibleBy": "Finance + C-level", "s3Prefix": "_shared/knowledge/financial-reports/"},
        {"id": "kb-hr", "name": "HR Policies", "scope": "department", "scopeName": "HR & Admin", "docCount": 10, "vectorCount": 2800, "sizeMB": "6.2", "status": "indexed", "lastUpdated": "2026-03-14T00:00:00Z", "accessibleBy": "HR dept only", "s3Prefix": "_shared/knowledge/hr-policies/"},
        {"id": "kb-legal", "name": "Contract Templates", "scope": "department", "scopeName": "Legal & Compliance", "docCount": 18, "vectorCount": 5200, "sizeMB": "14.1", "status": "indexed", "lastUpdated": "2026-03-18T00:00:00Z", "accessibleBy": "Legal dept only", "s3Prefix": "_shared/knowledge/contract-templates/"},
        {"id": "kb-customer", "name": "Customer Playbooks", "scope": "department", "scopeName": "Customer Success", "docCount": 7, "vectorCount": 1900, "sizeMB": "4.8", "status": "indexed", "lastUpdated": "2026-03-17T00:00:00Z", "accessibleBy": "CS + Sales", "s3Prefix": "_shared/knowledge/customer-playbooks/"},
        {"id": "kb-org-directory", "name": "Company Directory", "scope": "global", "scopeName": "All Employees", "docCount": 1, "vectorCount": 200, "sizeMB": "0.1", "status": "indexed", "lastUpdated": "2026-03-28T00:00:00Z", "accessibleBy": "All employees", "s3Prefix": "_shared/knowledge/org-directory/"},
    ]

    for kb in kbs:
        items.append({"PK": ORG, "SK": f"KB#{kb['id']}", "GSI1PK": "TYPE#kb", "GSI1SK": f"KB#{kb['id']}", **kb})

    print(f"Writing {len(items)} knowledge base items...")
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)
    print("Done!")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--table", default="openclaw-enterprise")
    p.add_argument("--region", default="us-east-2")
    a = p.parse_args()
    seed(a.table, a.region)
