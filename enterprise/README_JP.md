# OpenClaw Enterprise on AgentCore

**完全なドキュメント:** **[README_ENTERPRISE.md](../README_ENTERPRISE.md)**

**[インタラクティブUIガイド](https://aws-samples.github.io/sample-OpenClaw-on-AWS-with-Bedrock/ui-guide.html)** — アーキテクチャ設計、すべての管理者およびポータルページ、デプロイメントガイド、プラットフォームのスクリーンショットをカバーする25ページのバイリンガルドキュメント。プラットフォームが何をするか、どのように使用するかを理解するには、ここから始めてください。

---

## クイックスタート

```bash
cd enterprise
cp .env.example .env        # 編集: STACK_NAME、REGION、ADMIN_PASSWORD
bash deploy.sh              # 約15分 — インフラ + Dockerビルド + シード
```

次に、[README_ENTERPRISE.md](../README_ENTERPRISE.md) のステップ4〜6に従って、Admin ConsoleとGatewayサービスをデプロイします。

## 主要リンク

| リソース | パス |
|----------|------|
| インタラクティブUIガイド | [ui-guide.html](https://aws-samples.github.io/sample-OpenClaw-on-AWS-with-Bedrock/ui-guide.html) |
| 完全なドキュメント | [README_ENTERPRISE.md](../README_ENTERPRISE.md) |
| CloudFormationテンプレート | [clawdbot-bedrock-agentcore-multitenancy.yaml](clawdbot-bedrock-agentcore-multitenancy.yaml) |
| 環境レジストリ | [docs/environments.md](docs/environments.md) |
| テスト計画 (62+ケース) | [TESTING.md](TESTING.md) |
| デプロイメントスクリプト | [deploy.sh](deploy.sh) |
| 環境設定 | [.env.example](.env.example) |
| OIDC SSOセットアップ | [docs/OIDC_SSO_SETUP.md](docs/OIDC_SSO_SETUP.md) |

## アーキテクチャ

```
Admin Console (React + FastAPI、30以上のページ)
  ├── Admin: Dashboard、Agent Factory、Security Center、Monitor、Audit、Usage
  ├── Portal: Chat、Profile、Skills、Requests、Connect IM、My Agents
  ├── 3ロールRBAC (admin / manager / employee)
  └── デュアル認証: Azure AD (Microsoft Entra ID) SSO + 従業員ID/パスワード

4ティアランタイムアーキテクチャ:
  Standard    → Nova 2 Lite、スコープ化されたIAM、中程度のガードレール
  Restricted  → DeepSeek v3.2、部門スコープのIAM、厳格なガードレール
  Engineering → Claude Sonnet 4.5、エンジニアリングIAM、ガードレールなし
  Executive   → Claude Sonnet 4.6、完全なIAM、ガードレールなし

デュアルデプロイメントモード:
  Serverless  → AgentCore Firecracker microVM (デフォルト、従量課金)
  Always-On   → ECS Fargate (管理者トグル、24/7、EFS、直接IM)
```

## OpenClawバージョン

Enterpriseは `agent-container/Dockerfile` と `exec-agent/Dockerfile` の両方で **OpenClaw 2026.3.24** に固定されています。アップグレードしないでください — 新しいバージョンはIMチャネル統合を破損します。
