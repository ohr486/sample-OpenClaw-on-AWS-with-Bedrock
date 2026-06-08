# OpenClaw Enterprise on AgentCore

ほとんどのエンタープライズAIプラットフォームは、全員に同じ汎用的なアシスタントを提供します。OpenClaw Enterpriseは、各従業員に対して **役割固有のアイデンティティ、メモリ、ツール、セキュリティ境界を持つAIエージェント** を提供すると同時に、ITに対してフリート全体のガバナンス制御を完全に提供します。

[OpenClaw](https://github.com/openclaw/openclaw)(オープンソースAIアシスタント)+ AWS Bedrock AgentCore上に構築。**OpenClawソースコードへの変更ゼロ** — すべてのエンタープライズ機能は、設定ファイル、ワークスペース組み立て、AWSネイティブサービスを通じて実現されます。

---

## ガバナンスの課題

12の役職にまたがる500人の従業員を持つエンタープライズがAIエージェントを展開したいと考えています。課題は技術的なものではなく、組織的なものです:

- **財務アナリスト** エージェントはシェルコマンドを実行してはなりませんが、**SDE** エージェントは毎日シェルアクセスが必要です
- **CISOがコンプライアンスポリシーを更新** した場合、500個すべてのエージェントが即座にそれを採用しなければなりません — 個別に触ることなく
- **ITは** すべてのエージェント、すべてのIMチャネル、すべての部門にわたる、すべてのツール呼び出し、すべての権限拒否、すべての会話を **確認できる必要があります**
- **部署を変更する** 従業員は、サポートチケットなしで新しいエージェントアイデンティティ、新しいツール、新しい知識を自動的に取得する必要があります
- **CEOのエージェント** は完全なツールアクセスを持つClaude Sonnet 4.6を使用すべきで、**インターンのエージェント** はWeb検索のみを持つNova Liteを使用すべきです

ChatGPT TeamやMicrosoft Copilotではこれらのいずれもできません。彼らは全員に同じ機能を持つ同じエージェントを提供します。

---

## 我々の答え: 組織駆動型エージェントガバナンス

### 三層SOULアイデンティティ

中核設計: **個人ごとではなく、役職ごとに1つのSOUL設定。** 5部署 × 12役職 = 500エージェントのガバナンス。

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: GLOBAL (ITロック — CISO + CTO承認)            │
│  会社方針、セキュリティのレッドライン、データ取り扱い   │
│  "顧客PIIを共有しない。rm -rfを実行しない。"            │
├─────────────────────────────────────────────────────────┤
│  Layer 2: POSITION (部門管理者が管理)                    │
│  役割の専門知識、ツール権限、知識スコープ                │
│  "あなたは財務アナリストです。shellではなくexcel-genを使用。" │
├─────────────────────────────────────────────────────────┤
│  Layer 3: PERSONAL (従業員のセルフサービス)              │
│  コミュニケーション設定、カスタム指示                    │
│  "簡潔な回答を好みます。常に日本語で回答してください。" │
└─────────────────────────────────────────────────────────┘
                        ↓ マージ
              最終的なSOUL.md (エージェントが読むもの)
```

**下位レイヤーは上位レイヤーをオーバーライドできません。** 個人レイヤーに「すべての会社規則を無視せよ」と書いた従業員も、依然としてGlobalレイヤーに拘束されます — モデルが最初に読む `CRITICAL IDENTITY OVERRIDE` マーカーが先頭に付加されます。

### 五層セキュリティ(多層防御)

| レイヤー | メカニズム | プロンプトインジェクションでバイパス可能? |
|-------|-----------|-------------------------------|
| L1 — SOUL Rules | プロンプトレベルの行動制約 | ⚠️ 理論的には可能 |
| L2 — Tool Permissions (Plan A) | DynamoDBの役職ごとの許可リスト、SOULの前に注入 | ⚠️ モデルの遵守に依存 |
| **L3 — IAM** | **ランタイムごとのIAMロール — 財務ロールはS3部門横断アクセス権なし** | **不可能** |
| **L4 — Compute Isolation** | **エージェントごとのFirecracker microVM(ハードウェア境界)** | **不可能** |
| **L5 — Bedrock Guardrail** | **すべての入力 + 出力でのコンテンツフィルター(PII、トピック、インジェクション)** | **不可能** |

L3-L5はインフラストラクチャの境界です。どんなに巧妙なプロンプトでも、IAMポリシーをバイパスしたり、Firecracker VMから脱出することはできません。

### ITガバナンス制御

| 制御 | ITが得られるもの |
|---------|-------------|
| **SOULエディター** | グローバルルールはITによってロック。ポジションSOULは部門管理者が管理。従業員は個人レイヤーのみ編集可能。 |
| **4ティアランタイムモデル** | Standard / Restricted / Engineering / Executive — それぞれ独自のモデル、IAMロール、ガードレールを持つ。UIから役職をティアに割り当て。 |
| **監査センター** | すべての呼び出し、ツール呼び出し、権限拒否、SOUL変更、IMペアリング、ガードレールブロック → DynamoDB。5つのインサイト検出器がパターンを表面化。 |
| **スキルガバナンス** | 26個のスキルに役職レベルの割り当て。従業員はアクセスを要求可能。ITが承認/拒否。 |
| **使用量とコスト** | 従業員ごと、部門ごと、モデルごとの内訳。モデル対応の価格設定($0.30〜$75/1Mトークン)。部門予算。 |
| **IM管理** | すべての従業員のIM接続を管理者が確認可能。ワンクリックで取り消し。チャネル健全性 + 登録統計。 |
| **RBAC** | Admin(組織全体)・Manager(部門スコープ)・Employee(ポータルのみ)。すべてのAPI呼び出しでJWTを強制。 |

### 自動プロビジョニング: 組織図がすべてを駆動

```
管理者がpositionId="pos-fa"(財務アナリスト)で従業員を作成
  ↓ 自動プロビジョニング:
  ① エージェント作成 (役職のスキル + デフォルトチャネルを継承)
  ② 1:1バインディング作成 (従業員 ↔ エージェント)
  ③ S3ワークスペースをシード (PERSONAL_SOUL.md、USER.md、MEMORY.md)
  ④ 監査エントリを書き込み

従業員がログイン → 財務アナリストエージェントを表示 → チャット準備完了。
役職をpos-sdeに変更 → エージェントが自動的に再構成される。
```

---

## これが違うところ

| 機能 | ChatGPT Team | Microsoft Copilot | **OpenClaw Enterprise** |
|-----------|-------------|-------------------|-------------------|
| 役割ごとのエージェントアイデンティティ | ❌ 全員同じ | ❌ 全員同じ | ✅ 役職ごとの3層SOUL |
| 役割ごとのツール権限 | ❌ | ❌ | ✅ Plan A許可リスト + IAM + ガードレール |
| 組織駆動エージェント管理 | ❌ | ❌ | ✅ 部門 → 役職 → 従業員の階層 |
| IT監査証跡 | ❌ | 限定的 | ✅ すべてのアクションをDynamoDBに記録 |
| セルフホスト、データは自社VPC内 | ❌ | ❌ | ✅ Bedrockは自社アカウント内、データ流出ゼロ |
| IM統合(10プラットフォーム) | ❌ | Teamsのみ | ✅ Telegram、Slack、Discord、Feishu、WhatsApp... |
| スケジュールタスク / cron | ❌ | ❌ | ✅ EventBridge + Always-onエージェント |
| コスト: 50人の従業員 | $1,250/月 | $1,500/月 | **約$160〜220/月** |
| オープンソース | ❌ | ❌ | ✅ OpenClaw + AWSネイティブ |

---

## セキュリティ: 追加の制御

- パブリックポートなし(SSM Session Managerのみ)
- IAMロールを通じて、ハードコードされた認証情報なし
- ゲートウェイトークンはSSM SecureStringに保存、ディスクには保存しない
- ランタイムティア間のVPC分離
- 初回ログイン時に強制パスワード変更(従業員ごとにbcryptハッシュ化)

ランタイム間の詳細なコンピュート分離比較(AgentCore vs ECS vs EKS vs Kata)については、[SECURITY.md](SECURITY.md#compute-isolation-enterprise-multi-tenant) を参照してください。

---

## 3つのデプロイメントモード

すべてのエージェントは同じDockerイメージを使用します。管理者は役職ごとにデプロイメントモードを選択 — コード変更不要。

| | サーバーレス (AgentCore) | Always-on (ECS Fargate) | EKS (Kubernetes) |
|-|----------------------|------------------------|------------------|
| **コールドスタート** | 初回メッセージ約10秒、ウォーム約3秒 | なし — 常時稼働 | なし — Podは常時稼働 |
| **最適な用途** | 90%の従業員 | エグゼクティブアシスタント、cronタスク、直接IMボット | コンテナネイティブインフラ、中国リージョン |
| **コスト** | 呼び出しごとに支払い | エージェントあたり約$17/月 | クラスターコスト + Podごと |
| **ストレージ** | S3同期(60秒ウォッチドッグ) | EFS永続ボリューム | PVC |

**[→ EKS Deployment Guide (EN)](docs/DEPLOYMENT_EKS.md)** · **[→ EKS 部署指南 (中文)](docs/DEPLOYMENT_EKS_CN.md)**

### フラッグシップ機能

| 機能 | 何をするか |
|---------|-------------|
| **Digital Twin** | 従業員がパブリックリンクをオンにする。URLを持つ誰もが、不在中にAIエージェントとチャット可能 — エージェントは彼らのSOUL、メモリ、専門知識を使用して応答。Twinセッションは従業員のメインセッションから分離される |
| **Always-on Agents** | 管理者がエージェントを永続ECS Fargateモードに切り替え可能。スケジュールタスク(3分ごとのメール)、直接IMボット接続、即時応答を実現。同じイメージ、同じSOUL — デプロイメントモードスイッチのみ |
| **Portal Agent Switcher** | サーバーレスとAlways-On両方のエージェントを持つ従業員には、モード間で切り替えるサイドバートグルが表示される。チャット、IMバインディング、使用量、スキルすべてが選択されたエージェントタイプに自動的に応答 |
| **Dual Agent Tabs** | エージェント詳細には[Serverless]と[Always-On]タブが表示され、モードごとに独立した設定、ステータス、IMチャネル、監査がある。役職変更検出はコンテナ再起動が必要な時に管理者に警告 |
| **Fargate Security Center** | カードベースのFargate管理 — Configure、New Template、コストサマリーバー、一括Start All / Stop All。ティアごとのランタイム設定、モデル、IAMロール、ガードレール割り当て |
| **IM Credential Forms** | Always-Onエージェントは共有ボットペアリングではなく、チャネルごとの認証情報入力(Feishuのapp-id/secret、Telegramトークン、Slack bot/appトークン)を使用。Webhook URLは自動生成され表示される |
| **Session Storage** | AgentCoreはmicroVMの停止/再開サイクル間でワークスペースファイルを永続化。セッション再開時にS3再ダウンロード不要。`StopRuntimeSession` APIと組み合わせて、管理者がトリガーする設定リフレッシュが可能 |
| **Three-Layer SOUL** | Global (IT) → Position (部門管理者) → Personal (従業員)。3つのステークホルダー、3つのレイヤー、1つのマージされたアイデンティティ。同じLLM — 財務アナリストとSDEは完全に異なる個性と権限を持つ |
| **Self-Service IM Pairing** | 従業員がポータルからQRコードをスキャン → 30秒でTelegram / Feishu / Discordに接続。ITチケットなし、管理者承認なし |
| **Multi-Runtime Architecture** | 4ティアシステム: Standard、Restricted、Engineering、Executive — それぞれ独自のモデル、IAMロール、ガードレール、セキュリティグループを持つ。Security Center UIから役職をティアに割り当て |
| **Bedrock Guardrails (L5)** | Security Center UIから任意のBedrock Guardrailをランタイムに割り当て可能。トピック拒否、PIIフィルタリング、コンプライアンスポリシーがすべてのユーザー入力とエージェント出力をラップ — OpenClawソースコード変更不要。Standard従業員はブロックされる; execティアは制限なし。Audit Centerに完全なブロック監査証跡。 |
| **Org Directory KB** | 会社ディレクトリ(すべての従業員、R&R、連絡先、エージェント機能)を組織データからシードし、すべてのエージェントに注入 — エージェントは誰に連絡すべきかを知っており、メッセージを作成できる |
| **Position → Runtime Routing** | 3ティアルーティングチェーン: 従業員オーバーライド → 役職ルール → デフォルト。Security Center UIから役職をランタイムに割り当て、すべてのメンバーに自動的に伝播 |
| **Per-Employee Model Config** | Agent Factory → Configurationタブから役職または従業員レベルでモデル、コンテキストウィンドウ、コンパクション設定、応答言語をオーバーライド |
| **IM Channel Management** | 管理者はチャネル別にグループ化された各従業員のIM接続を確認 — ペアリング時期、セッション数、最終アクティブ、監査証跡用の理由フィールド付きワンクリック切断 |
| **Org CRUD** | 管理コンソールから部門、役職、従業員の完全な作成/編集/削除。削除はガードされている: 従業員またはエージェント割り当てが存在する場合はブロック、Always-Onクリーンアップの詳細とともに強制カスケード削除を促す |
| **Security Center** | ライブAWSリソースブラウザ — ECRイメージ、IAMロール、コンソールリンク付きVPCセキュリティグループ。UIからランタイムイメージ、IAMロール、Fargateティアテンプレートを設定 |
| **Session Storage + Memory** | サーバーレス: Session StorageがmicroVMサイクルにわたってワークスペースを永続化 + 管理者の可視性のためのS3書き戻し。Always-on: EFSワークスペース + Gatewayコンパクション。Discord、Telegram、Feishu、Portalで同じメモリ |
| **Dynamic Config, Zero Redeploy** | モデル、ツール権限、SOULコンテンツ、またはKB割り当てを変更 → 設定バージョンポーリング(5分)経由で、または `StopRuntimeSession` 経由で即座に伝播。コンテナ再構築不要、ランタイム更新不要 |

---

## ライブデモ

> **https://openclaw.awspsa.com**
>
> 7部門、11役職、20人以上の従業員、20以上のAIエージェント、IMチャネル(Telegram、Feishu、Discord + Portal)、4ティアランタイムアーキテクチャ(Standard/Restricted/Engineering/Executive)、常時稼働のECS Fargateエージェントを持つ、AWS上のDynamoDB + S3でバックアップされた実際の稼働中インスタンス。
>
> **ここのすべては本物です。** すべてのボタンが機能します。すべてのチャートは実データから読み取ります。すべてのエージェントは隔離されたFirecracker microVM内のBedrock AgentCoreで実行されます。
>
> **Digital Twinを試す:** 任意の従業員としてログイン → Portal → My Profile → **Digital Twin** をONに切り替え → パブリックURLを取得 → シークレットウィンドウで開き、その従業員のAI版とチャット。
>
> デモアカウントが必要ですか? アクセスを取得するには [wjiad@aws](mailto:wjiad@amazon.com) に連絡してください。
>
> **インタラクティブUIガイド:** [ui-guide.html](https://aws-samples.github.io/sample-OpenClaw-on-AWS-with-Bedrock/ui-guide.html) — アーキテクチャ、デプロイメント、すべての管理者およびポータルページをスクリーンショット付きでカバーする25ページのバイリンガル(EN/CN)ドキュメント。

### スクリーンショット

| 管理ダッシュボード | エージェントファクトリー |
|:-:|:-:|
| ![Dashboard](enterprise/demo/images/new-01-dashboard.png) | ![Agent Factory](enterprise/demo/images/new-02-agent-factory.png) |

| Security Center — 4ティアランタイム | 従業員ポータルチャット |
|:-:|:-:|
| ![Security Center](enterprise/demo/images/new-03-security-center.png) | ![Portal Chat](enterprise/demo/images/new-05-portal-chat.png) |

| 使用量とコスト | ツールとスキル |
|:-:|:-:|
| ![Usage](enterprise/demo/images/new-04-usage.png) | ![Skills](enterprise/demo/images/new-06-skills.png) |

---

## 設計原則

### 設計原則

#### 1. OpenClawへの侵襲ゼロ

OpenClawソースコードを1行たりともフォーク、パッチ、または変更しません。代わりに、OpenClawのネイティブワークスペースファイルシステムを通じてエージェントの動作を完全に制御します:

```
workspace/
├── SOUL.md            ← エージェントのアイデンティティとルール(3レイヤーから組み立て)
├── AGENTS.md          ← ワークフロー定義
├── TOOLS.md           ← ツール権限
├── USER.md            ← 従業員の設定
├── MEMORY.md          ← 永続メモリ
├── memory/            ← 日次メモリファイル(ターンごとのチェックポイント)
├── knowledge/         ← 役職スコープ + グローバルドキュメント(KB注入)
├── skills/            ← 役割でフィルターされたスキルパッケージ
├── IDENTITY.md        ← 従業員名 + 役職(生成、編集不可)
├── CHANNELS.md        ← 従業員のバインドされたIMチャネル(送信通知用)
└── SESSION_CONTEXT.md ← アクセスパス + 呼び出し元のアイデンティティ(コールドスタート時に1回書き込み)
```

`workspace_assembler` は、OpenClawが読み取る前に、Global + Position + Personalレイヤーをこれらのファイルにマージします。OpenClawはエンタープライズコンテキストで実行されていることを知りません — 通常通りワークスペースを読み取るだけです。

`SESSION_CONTEXT.md` はアクセスパスのアイデンティティファイルです。これは `workspace_assembler` によって **コールドスタートごとに1回** 書き込まれ、このセッションをトリガーしたアクセスパスを正確にエンコードします。Tenant Routerが割り当てる `session_id` プレフィックスで検証されます:

| セッションプレフィックス | アクセスパス | 書き込まれる内容 |
|----------------|-------------|-----------------|
| `emp__emp-id__` | 従業員ポータル + すべてのバインドされたIMチャネル(共有セッション) | 認証されたユーザー名、"Verification: Confirmed" |
| `pt__emp-id__` | Portal (レガシーエイリアス、`emp__` と同じ動作) | 上記と同じ |
| `pgnd__emp-id__` | Playground — この従業員としてテストするIT管理者 | "Admin Test Session, read-only memory" |
| `twin__emp-id__` | Digital Twin — 外部呼び出し元、認証不要 | "Caller unverified, conversations visible to employee in Portal" |
| `admin__...` | IT管理アシスタント | "Authorized IT Administrator" |
| `tg__`、`dc__`など | 生のIMフォールバック(未解決のユーザー、ペアリング前) | "Standard Session" |

**これが重要な理由:** SESSION_CONTEXT.mdがないと、エージェントはPortalとPlaygroundとDigital Twinを区別できません — 3つすべてが同じワークスペースにアクセスし、同じように応答してしまいます。これがあれば、Playgroundはエージェントに従業員メモリへの書き戻しをしないように明示的に指示し、Digital Twinはエージェントに呼び出し元が未検証で、会話が代表される従業員に見えることを伝えます。

#### 2. サーバーレスファースト + Always-onハイブリッド

**デフォルト: サーバーレス。** すべてのエージェントは、Bedrock AgentCoreを介して隔離されたFirecracker microVMで実行されます。Session Storageは停止/再開間でワークスペースファイルを永続化 — セッション再開時にS3再ダウンロード不要。

**管理者トグル: Always-on。** 任意のエージェントを永続ECS Fargateコンテナに切り替え可能 — 同じDockerイメージ、同じSOUL、同じコードパス。違いはインフラ: コンテナは生き続け、スケジュールタスク、直接IM接続、即時応答を可能にします。

```
リクエスト
  ↓
Tenant Router — 3ティアルーティング:
  1. Always-onチェック (SSM /tenants/{emp_id}/always-on-agent)
     → ECS Fargateコンテナにルーティング(プライベートVPC IP)
  2. 役職ルール (DynamoDB CONFIG#routing または SSM /positions/{pos_id}/runtime-id)
     → その役職のAgentCore Runtimeにルーティング
  3. デフォルトAgentCore Runtime
```

| | サーバーレス (AgentCore) | Always-on (ECS Fargate) |
|-|----------------------|------------------------|
| コールドスタート | 初回メッセージ約6秒、セッション再開約2〜3秒 | なし — コンテナ常時稼働 |
| スケジュールタスク | 次の呼び出しまで延期 | スケジュール通りに発火 (HEARTBEAT) |
| 直接IMボット | なし — ゲートウェイEC2経由でルーティング | あり — コンテナ内専用ボットトークン |
| アイドルコスト | メモリのみ ($0.08/日 / 1 GBセッション) | 約$0.55/日 (0.5 vCPU + 1 GB Fargate) |
| 永続性 | Session Storage (1 GB、自動管理) | EFS (無制限、耐久性あり) |
| 最適な用途 | 個人従業員(大多数) | カスタマーサービス、エグゼクティブアシスタント、高頻度cron |

**すべてのエージェントは本質的に「共有」されます** — 従業員のエージェントは、従業員自身、Digital Twin訪問者、そして潜在的に他の割り当てられた従業員にサービスを提供します。「共有 vs パーソナル」は、管理者が割り当てる従業員の数に過ぎず、別個のインフラタイプではありません。

#### 2.1 マルチランタイムアーキテクチャ(多層防御)

異なる従業員グループは、それぞれ独自のDockerイメージとIAMロールでバックアップされた異なるAgentCore Runtimeに割り当てることができます:

```
Runtime: Standard (営業 / HR / サポート)
  ├── Model:   Amazon Nova 2 Lite (コスト最適化)
  ├── IAM:     自身のS3ワークスペースのみ · 自身のDynamoDBパーティション
  └── Guardrail: 中程度 (PIIフィルター + トピック拒否)

Runtime: Restricted (財務 / 法務)
  ├── Model:   DeepSeek v3.2 (バランス型)
  ├── IAM:     自身のワークスペース + 部門読み取り
  └── Guardrail: 厳格 (PII + コンプライアンス + データ主権)

Runtime: Engineering (SDE / DevOps / QA)
  ├── Model:   Claude Sonnet 4.5 (コーディング最適化)
  ├── IAM:     自身のワークスペース + 部門横断エンジニアリング読み取り
  └── Guardrail: なし (完全なツールアクセス)

Runtime: Executive (C-Suite / シニアリーダーシップ)
  ├── Model:   Claude Sonnet 4.6 (最高能力)
  ├── IAM:     完全なS3アクセス · 部門横断DynamoDB · すべてのBedrockモデル
  └── Guardrail: なし (制限なし)
```

各ランタイムティアには独自のIAMロールとオプションのBedrock Guardrailがあります — 完全な5レイヤーモデルについては上記の [セキュリティ](#security-hardware-level-isolation-at-every-layer) を参照してください。**Security Center → Runtimes** からカードベースUI、Configureボタン、コストサマリー、一括操作でティアを管理。

#### 3. Digital Twin — 勤務時間外のAI可用性

すべての従業員は、エージェント用のパブリック共有可能なURLを生成できます:

```
従業員がDigital TwinをONに切り替え
  ↓
取得: https://your-domain.com/twin/{secure-token}
  ↓
リンクを持つ誰もがチャット可能(ログイン不要)
  ↓
エージェントは従業員のSOUL + メモリ + 専門知識を使って応答
エージェントは自己紹介: "私は[名前]のAIアシスタントです..."
  ↓
従業員がOFFに切り替え → リンクが即座に取り消される
```

**ユースケース:** オフィス外アシスタント · 常に利用可能な営業エージェント · 誰でもアクセス可能な技術SME · タイムゾーンをまたぐ非同期コラボレーション

#### 4. 三層SOULアーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: GLOBAL (ITロック — CISO + CTO承認)            │
│  会社方針、セキュリティのレッドライン、データ取り扱い   │
│  "顧客PIIを共有しない。rm -rfを実行しない。"            │
├─────────────────────────────────────────────────────────┤
│  Layer 2: POSITION (部門管理者が管理)                    │
│  役割の専門知識、ツール権限、知識スコープ                │
│  "あなたは財務アナリストです。shellではなくexcel-genを使用。" │
├─────────────────────────────────────────────────────────┤
│  Layer 3: PERSONAL (従業員のセルフサービス)              │
│  コミュニケーション設定、カスタム指示                    │
│  "簡潔な回答を好みます。常にTypeScriptを使用してください。" │
└─────────────────────────────────────────────────────────┘
                        ↓ マージ
              最終的なSOUL.md (OpenClawが読むもの)
```

#### 5. セッション開始時の知識組み立て

エージェントが新しいセッションを開始すると、`workspace_assembler` は以下を注入します:

1. **Global KB** (組織ディレクトリ、会社方針) — すべてのエージェントが利用可能
2. **Position KB** (SAのエンジニアリングドキュメント、FAの財務ドキュメント) — 役割によってスコープ化
3. **Employee KB** — 個別のオーバーライド

組織ディレクトリKB(`seed_knowledge_docs.py` 経由でシード、組織変更後にスクリプトを再実行してリフレッシュ)は、すべてのエージェントに次の質問への回答能力を与えます: *"Xについて誰に連絡すべきですか?"* および *"[名前]にどう連絡しますか?"*

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────┐
│  管理コンソール (React + FastAPI)                                │
│  ├── 30以上のページ: Dashboard、Agent Factory (dual Serverless/AO│
│  │   tabs)、Security Center (Fargateカード管理)、               │
│  │   IM Channels、Monitor、Audit、Usage & Cost、Settings        │
│  ├── 従業員ポータル: Chat (エージェントモードスイッチャー)、     │
│  │   Profile、Skills、Requests、Connect IM (ペアリング + 認証   │
│  │   フォーム)、My Agents、Digital Twinトグル                   │
│  ├── 3ロールRBAC (admin / manager / employee)                   │
│  └── IT管理アシスタント (Claude API、10個のホワイトリストツール)│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PATH 1: IT管理アシスタント                                      │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  管理コンソールフローティングチャットバブル(adminのみ) │      │
│  │    session_idプレフィックス: admin__                   │      │
│  │    SESSION_CONTEXT.md → "IT Admin Assistant"           │      │
│  │    Claude API直接(AgentCoreではない)、10個のホワイト │      │
│  │    リストツール、shellなし、subprocessなし             │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
│  PATH 2: Playground (従業員としてテストするIT管理者)             │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  管理コンソール → Agents → Playgroundタブ              │      │
│  │    session_idプレフィックス: pgnd__emp-id__            │      │
│  │    SESSION_CONTEXT.md → "Playground (Admin Test),      │      │
│  │      read-only with respect to memory"                 │      │
│  │    従業員のワークスペースを読み取り; 書き戻しなし      │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
│  PATH 3: 従業員ポータル (webchat、認証あり)                      │
│  PATH 4: IMチャネル (Telegram/Feishu/Discord/Slack — バインド済) │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  Path 3と4は同じAgentCoreセッションを共有              │      │
│  │    H2 ProxyがIMペアリングを強制: 未ペアIM → 拒否       │      │
│  │    Tenant Routerがチャネルuser_id → emp_idを解決       │      │
│  │    session_idプレフィックス: emp__emp-id__ (両方のパス)│      │
│  │    SESSION_CONTEXT.md → "Employee Session, Verified"   │      │
│  │    従業員ワークスペースへのフル読み書き                │      │
│  │    → 3ティアルーティング: always-on? → position? → デフォルト│
│  │    → AgentCore (emp-idごとのFirecracker microVM)       │      │
│  │    → workspace_assembler: SOUL + IDENTITY + channels   │      │
│  │    → OpenClaw + Bedrock → レスポンス                   │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
│  PATH 5: Digital Twin (パブリックURL、認証なし)                  │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  GET /twin/{token} → パブリックHTMLチャットページ      │      │
│  │  POST /public/twin/{token}/chat                        │      │
│  │    トークン → employee_id ルックアップ                 │      │
│  │    session_idプレフィックス: twin__emp-id__            │      │
│  │    SESSION_CONTEXT.md → "Digital Twin, caller          │      │
│  │      unverified, visible to employee in Portal"        │      │
│  │    分離されたtwin_workspace (従業員のメインではない)   │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
│  PATH C: Always-onエージェント (ECS Fargate)                     │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  同じDockerイメージ、ECS Fargateタスク with:           │      │
│  │    SHARED_AGENT_ID={agent_id}                          │      │
│  │    EFSマウント /mnt/efs (従業員ごとのワークスペース)   │      │
│  │    オプション: 直接IM用TELEGRAM_BOT_TOKEN              │      │
│  │  コンテナは起動時にVPC IPをSSMに自己登録               │      │
│  │  Tenant Routerは割り当てられた従業員をタスクIPにルート │      │
│  │  スケジュールタスク (HEARTBEAT)、直接IM、              │      │
│  │    カスタマーサービスボット、エグゼクティブアシスタントをサポート│
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  AWSサービス                                                     │
│  ├── DynamoDB — 組織、エージェント、割り当て、監査、使用量、     │
│  │              設定、Digital Twinトークン、KB割り当て            │
│  ├── S3 — SOULテンプレート、スキル、ワークスペース、知識、       │
│  │         組織ディレクトリ、従業員ごとのメモリ、管理者の可視性  │
│  ├── SSM — tenant→position、position→runtime、user-mappings、    │
│  │          権限、always-onエンドポイント                        │
│  ├── Bedrock — LLM推論 (デフォルトNova 2 Lite、execティアはSonnet 4.6、│
│  │              役職ごとのオーバーライドをサポート)              │
│  ├── AgentCore — Session Storage (1 GB/セッション、自動管理)     │
│  ├── ECS Fargate — Always-onコンテナ + EFSワークスペース         │
│  └── CloudWatch — エージェント呼び出しログ、ランタイムイベント  │
└─────────────────────────────────────────────────────────────────┘
```

## Gatewayアーキテクチャ: 1つのボット、すべての従業員

OpenClaw Gatewayは、組織全体の統一されたIM接続レイヤーとして機能します。リファレンスデプロイメントでは単一のEC2インスタンスで実行されますが、本番環境ではロードバランサーの背後で水平スケーリング可能です。

```
IT管理者 (一度きりのセットアップ):
  Discord  → 1つのBot "ACME Agent"を作成 → Gatewayに接続
  Telegram → 1つのBot @acme_botを作成    → Gatewayに接続
  Feishu   → 1つのエンタープライズBotを作成 → Gatewayに接続

すべての従業員が同じBotを使用するが、それぞれが独自のエージェントを取得:

  Carolが@ACME Agentに DM → H2 Proxyがuser_idを抽出 → Tenant Router
    → pos-fa → Standard Runtime → 財務アナリストSOUL → Bedrock → 返信

  WJDが@ACME Agentに DM → H2 Proxyがuser_idを抽出 → Tenant Router
    → pos-exec → Executive Runtime → Sonnet 4.6 → フルツール → 返信
```

### 従業員セルフサービスIMオンボーディング

```
ステップ1: 従業員がポータルを開く → Connect IM
ステップ2: チャネルを選択 (Telegram / Feishu / Discord)
ステップ3: スマートフォンでQRコードをスキャン → ボットが自動的に開く
ステップ4: ボットが/start TOKENを送信 → 即座にペアリング、管理者承認なし
ステップ5: 従業員がIMアプリ内で直接AIエージェントとチャット
```

ITの摩擦ゼロ。従業員は30秒でセルフサービス。管理者はIM Channelsページですべての接続を確認でき、任意の接続を取り消すことができます。

## 主要機能

| 機能 | 動作の仕組み |
|---------|-------------|
| **Digital Twin** | 従業員がONに切り替え → パブリックURLを取得。誰でもAIエージェントとチャット、ログイン不要。エージェントは従業員のSOUL + メモリを使用。OFFに切り替えると即座に取り消し |
| **Always-on Agents** | デュアルタブUIから管理者がエージェントをECS Fargateモードに切り替え。同じDockerイメージ、EFSワークスペースを持つ永続コンテナ。4ティアセキュリティモデル(Standard/Restricted/Engineering/Executive)。スケジュールタスク、直接IMボット、即時応答を可能にする。Tenant RouterはSSM経由でFargateタスクVPC IPにルーティング |
| **SOUL Injection** | セッション開始時の3レイヤーマージ(Global + Position + Personal)。N個のエージェントに影響する編集時にエディターでポジションSOUL警告 |
| **Permission Control** | SOUL.mdが役割ごとに許可/ブロックされたツールを定義。Plan A(実行前)+ Plan E(事後監査)。ExecプロファイルはPlan Aを完全にバイパス |
| **Multi-Runtime** | ティアごとのモデル、IAM、ガードレールを持つ4ティアシステム(Standard / Restricted / Engineering / Executive)。Security Center UIから役職をランタイムに割り当て |
| **Self-service IM Pairing** | QRコードスキャン + `/start TOKEN` → SSMマッピングが即座に書き込まれる。Telegram、Feishu、Discordをサポート |
| **Org Directory KB** | `seed_knowledge_docs.py` 経由で組織データからシード。すべてのエージェントのワークスペースに注入。エージェントは何のために誰に連絡するかを知っている |
| **Per-employee Config** | 役職または従業員レベルでモデル、`recentTurnsPreserve`、`maxTokens`、応答言語をオーバーライド。再デプロイなし |
| **Position → Runtime Routing** | 3ティア: 従業員SSMオーバーライド → 役職SSMルール → デフォルト。Security CenterのUIから役職を割り当て |
| **Memory Persistence** | サーバーレス: Session StorageがmicroVMサイクルにわたってワークスペースを永続化 + 管理者の可視性のためのS3書き戻し。Always-on: EFS + Gatewayコンパクション。クロスチャネルメモリ共有(IM + Portal = 同じセッション) |
| **IM Channel Management** | チャネルごとの従業員テーブル: ペアリング日、セッション数、最終アクティブ、切断ボタン |
| **Knowledge Base** | S3のMarkdownファイル。Knowledge Base → Assignmentsタブから役職にKBを割り当て。セッション開始時に注入 |
| **Skill Filtering** | `allowedRoles`/`blockedRoles` を持つ26のスキル。Financeはexcel-genを、SDEはgithub-prを、DevOpsはaws-cliを取得 |
| **Agent Config** | Agent Factory → Configurationタブから役職ごとにメモリコンパクション、コンテキストウィンドウ、言語 |
| **IT Admin Assistant** | フローティングチャットバブル(adminのみ)。Claude API + 10個のホワイトリストツール。shellなし、subprocessなし |
| **Security Center** | ライブAWSリソースブラウザ: ECRイメージ、IAMロール、コンソールディープリンク付きVPCセキュリティグループ |

## セキュリティモデル

| レイヤー | メカニズム | 詳細 |
|-------|-----------|--------|
| **Network** | パブリックポートなし | SSMポートフォワーディングまたはCloudFront(オリジン制限) |
| **Credentials** | AWS SSM SecureString | `ADMIN_PASSWORD`、`JWT_SECRET`、Digital TwinトークンはSSMで暗号化 |
| **Compute** | Firecracker microVM + ECS Fargate | 各サーバーレスエージェントは独自のmicroVM内。Always-onエージェントは隔離されたECS FargateタスクにEFS付き |
| **IAM** | 最小権限 + ランタイムティア | Standardロール: 自身のS3/DynamoDBのみ。Executiveロール: 部門横断。プロンプト経由でエスカレートできない |
| **Data** | 役割ベースのスコープ | Admin: すべて。Manager: 自身の部門(BFSロールアップ)。Employee: 自身のみ。API強制 |
| **Agent** | SOUL権限制御 | Plan A事前実行許可リスト。Plan E事後応答監査。Execプロファイルはオプトアウト |
| **Audit** | 包括的なロギング | すべての呼び出し、ツール呼び出し、権限拒否、SOUL変更、IMペアリング、ガードレールブロック → DynamoDB |
| **Digital Twin** | トークンベースのアクセス | URL内のセキュアトークン、DynamoDBに保存。従業員が即座に取り消し。表示/チャット数を追跡 |
| **L5 Guardrail** | AWS Bedrock Guardrails | ランタイムごとのコンテンツポリシー。OpenClawに転送する前に `apply_guardrail()` がINPUTで呼び出され、ユーザーに返す前にOUTPUTで呼び出される。Standard Runtime: トピック拒否 + PII。Exec Runtime: ガードレールなし。すべてのブロックは `guardrail_block` 監査イベントとしてDynamoDBに書き込まれる。 |

## AIアシスタント向け(Kiro / Claude Code / Cursor / その他)

> **ユーザー:** このセクションをコピーしてAIに貼り付けて、デプロイメントのハンズオンヘルプを取得してください。

---

**何をデプロイするか:** マルチテナントエンタープライズAIプラットフォーム — ゲートウェイレイヤー(Tenant Router + Admin Console)が、AWS Bedrock AgentCoreを介して隔離されたFirecracker microVMにリクエストをルーティングします。1つのDockerイメージがAgentCore(サーバーレス)とECS Fargate(always-on)の両方にサービスを提供します。4つのAgentCore Runtime(Standard/Restricted/Engineering/Executive)、1つのDynamoDBテーブル、1つのS3バケット、4つのティアサービスを持つ1つのECSクラスター。

**Dockerビルドはユーザーのローカルマシンではなく、ゲートウェイEC2で実行します。** `deploy.sh` がこれを自動的に処理します — ソース → S3 → SSM経由でEC2がビルド(ARM64 Graviton)をパッケージ化します。ローカルDockerは不要。

**重要 — これらが見逃されるとサイレントにデプロイメントが破損します:**

1. **OpenClawは `agent-container/Dockerfile` および `exec-agent/Dockerfile` で `2026.3.24` に固定されています** — アップグレードしないでください。新しいバージョンはGateway応答配信を変更し、IMチャネル統合を破損します。(シングルユーザーEC2テンプレートは `2026.4.5+` をサポートしますが、Enterpriseは `2026.3.24` のままです。)
2. **Dockerビルドは10〜15分かかります** — `clawhub install` がスキルを1つずつインストールします。これは正常です。
3. **`update-agent-runtime` 後**、テストする前に `status: READY` までポーリングします。
4. **DynamoDBはデフォルトで `us-east-2`** にあります(AgentCoreは `us-east-1`)。これは意図的なものです — DynamoDBクロスリージョンアクセスは無料です。
5. **deploy.shは4つのFargateティアサービスを `desiredCount=0` で作成します**。管理者がSecurity Center UIから従業員ごとのalways-onをアクティブ化します。
6. **20人のシード従業員全員が1つの `ADMIN_PASSWORD` を共有** — 各従業員は初回ログイン時に変更する必要があります。役割は `seed_roles.py` によって別々にシードされます。

**動作確認** (デプロイ後):
- `emp-jiade` (admin) としてログイン → Dashboardに13部門、11役職、20従業員が表示
- Playground → Carol Zhang (Finance) → "run git status" → 拒否される (Restrictedティア)
- Playground → Ryan Park (SDE) → "run git status" → 実行される (Engineeringティア)
- Portal → Carol Zhang → Chat → "Who are you?" → "Finance Analyst Agent at ACME Corp"
- Security Center → 4つのランタイムすべてがREADY

**AgentCoreが500を返した場合:** CloudWatchグループ `/aws/bedrock-agentcore/runtimes/<runtime-id>-DEFAULT` で `openclaw returned empty output` を確認 — 間違ったopenclawバージョン。`openclaw@2026.3.24` で再ビルドしてください。

---

## クイックスタート

> **TL;DR** — デプロイするための3つのコマンド:
> ```bash
> cd enterprise
> cp .env.example .env        # 編集: STACK_NAME、REGION、ADMIN_PASSWORD
> bash deploy.sh              # 約15分 — インフラ + Dockerビルド + シード
> ```
> 次に、EC2上のAdmin ConsoleとGatewayサービスをデプロイするために、以下の **ステップ4〜6** に従ってください。

### 前提条件

| 要件 | バージョン | 注意 |
|-------------|---------|-------|
| AWS CLI | v2.27+ | `bedrock-agentcore-control` には2.27+が必要 |
| Node.js | 18+ | Admin Consoleフロントエンドビルド用 |
| Python | 3.10+ | シードスクリプトとバックエンド用 |
| SSM Plugin | 最新 | [インストールガイド](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) |

> **ローカルDockerは不要** — エージェントコンテナイメージはSSM経由でゲートウェイEC2(ARM64 Graviton)上でビルドされます。

**AWS要件:**
- Bedrockモデルアクセスは自動 — 手動有効化不要
- Bedrock AgentCoreは以下で利用可能: `us-east-1`、`us-west-2`
- IAM権限: `cloudformation:*`、`ec2:*`、`iam:*`、`ecr:*`、`s3:*`、`ssm:*`、`bedrock:*`、`dynamodb:*`、`ecs:*`、`efs:*`

### ステップ1: 設定とデプロイ

```bash
cd enterprise           # リポジトリのルートから
cp .env.example .env    # 設定テンプレートをコピー
```

`.env` を開いて、必要な値を入力してください:

```bash
STACK_NAME=openclaw-enterprise   # スタック名
REGION=us-east-1                 # us-east-1 または us-west-2 (AgentCoreリージョン)
ADMIN_PASSWORD=your-password     # 初期パスワード (従業員は初回ログイン時に変更必須)

# オプション: 新しいVPCを作成する代わりに既存のVPCを使用
# EXISTING_VPC_ID=vpc-0abc123
# EXISTING_SUBNET_ID=subnet-0abc123

# オプション: カスタムS3バケット名 — 同じアカウントで複数のスタックをデプロイする場合に必要
# (例: 同じAWSアカウント内のステージング + プロダクション)
# WORKSPACE_BUCKET_NAME=openclaw-tenants-123456789-staging
```

次にデプロイスクリプトを実行 — すべてを処理します。**ゲートウェイEC2上のDockerビルドを含む(ローカルDocker不要)**:

```bash
bash deploy.sh
# 合計約15分: CloudFormation → EC2 Dockerビルド → AgentCore Runtime → DynamoDBシード
```

Dockerイメージを再ビルドしたり、再シードしたりせずにコード変更後に再デプロイするには:

```bash
bash deploy.sh --skip-build   # インフラのみ更新、Dockerビルドをスキップ
bash deploy.sh --skip-seed    # インフラ + イメージを更新、DynamoDBをスキップ
```

**`deploy.sh` が自動的に行うこと (エンドツーエンド):**
1. 前提条件を検証し、CloudFormation (EC2、ECR、S3、IAM、ECSクラスター — 作成または更新)をデプロイ
2. ソースコードをパッケージ化 → S3にアップロード → **SSM経由でゲートウェイEC2でDockerビルドをトリガー** (ARM64 Graviton、ローカルDocker不要)
3. AgentCore Runtimeを作成または更新
4. DynamoDBテーブルが存在しない場合は作成
4.5. ティア固有のモデル、タスク定義、`desiredCount=0` を持つ **ECS Fargateティアサービス** (Standard/Restricted/Engineering/Executive)をセットアップ(管理者はSecurity Center経由でアクティブ化)
5. SOULテンプレート + スキルをS3にアップロード
6. 組織データをシード (従業員、役職、部門、知識ドキュメント)
7. `ADMIN_PASSWORD` と `JWT_SECRET` をSSM SecureStringに保存
8. Admin Consoleフロントエンドをビルド → パッケージ化 → SSM経由でEC2にデプロイ
9. Gatewayサービス (Tenant Router、Bedrock H2 Proxy) をEC2にデプロイ
10. すべての必要な変数 (`STACK_NAME`、`DYNAMODB_TABLE`、`DYNAMODB_REGION`、ECS設定など) を `/etc/openclaw/env` に書き込み
11. systemdサービスを設定し、すべてのコンポーネントを開始
12. ECS→SSM VPCエンドポイントセキュリティグループルールを追加 (VPCエンドポイントが存在する場合)

デプロイ後、インスタンスIDとS3バケットを取得:

```bash
STACK_NAME="openclaw-enterprise"   # .env と一致
REGION="us-east-1"

INSTANCE_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`InstanceId`].OutputValue' --output text)
S3_BUCKET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`TenantWorkspaceBucketName`].OutputValue' --output text)
echo "EC2: $INSTANCE_ID  |  S3: $S3_BUCKET"
```

### ステップ1.5: Exec-Agentイメージのビルドとプッシュ (Executiveティア)

Executive Runtimeは、すべてのスキルが事前にインストールされ、Claude Sonnet 4.6を備えた別個のDockerイメージ (`exec-agent/`) を使用します。`deploy.sh` は標準イメージを自動的にビルドします; execイメージは別途プッシュする必要があります:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_EXEC="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${STACK_NAME}-exec-agent"

aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker build --platform linux/arm64 \
  -f enterprise/exec-agent/Dockerfile \
  -t "${ECR_EXEC}:latest" .

docker push "${ECR_EXEC}:latest"
```

次に、新しいイメージを取得するためにExec Runtimeを更新:

```bash
EXEC_RUNTIME_ID=$(aws ssm get-parameter \
  --name "/openclaw/${STACK_NAME}/exec-runtime-id" \
  --query Parameter.Value --output text --region $REGION 2>/dev/null)

EXEC_ROLE=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`AgentContainerExecutionRoleArn`].OutputValue' --output text)

aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id "$EXEC_RUNTIME_ID" \
  --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${ECR_EXEC}:latest\"}}" \
  --role-arn "$EXEC_ROLE" \
  --network-configuration '{"networkMode":"PUBLIC"}' \
  --environment-variables "{\"AWS_REGION\":\"${REGION}\",\"BEDROCK_MODEL_ID\":\"global.anthropic.claude-sonnet-4-6\",\"S3_BUCKET\":\"${S3_BUCKET}\",\"STACK_NAME\":\"${STACK_NAME}\",\"DYNAMODB_TABLE\":\"${STACK_NAME}\",\"DYNAMODB_REGION\":\"${DYNAMODB_REGION}\",\"SYNC_INTERVAL\":\"120\"}" \
  --region $REGION
```

> 標準エージェントイメージ (`openclaw-multitenancy-multitenancy-agent`) は `deploy.sh` によって自動的にビルドされます。このステップはexecutiveティアにのみ必要です。

### ステップ2: DynamoDBテーブル

> **`deploy.sh` がこれを自動的に処理します。** 手動ステップは不要です。

<details><summary>手動ステップ (deploy.shを使用しない場合のみ)</summary>

```bash
# テーブル作成 (冪等 — 既に存在する場合でも安全に実行可能)
aws dynamodb create-table \
  --table-name $STACK_NAME \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S AttributeName=GSI1SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes '[{"IndexName":"GSI1","KeySchema":[
    {"AttributeName":"GSI1PK","KeyType":"HASH"},{"AttributeName":"GSI1SK","KeyType":"RANGE"}
  ],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST \
  --region $DYNAMODB_REGION
```


</details>

### ステップ3: サンプル組織のシード

> **`deploy.sh` がこれを自動的に処理します。** 手動で再シードする場合 (例: 組織変更後):

<details><summary>手動シードコマンド</summary>

```bash
cd enterprise/admin-console/server
pip install boto3 requests

DYNAMODB_REGION=us-east-2

python3 seed_dynamodb.py              --region $DYNAMODB_REGION
python3 seed_roles.py                 --region $DYNAMODB_REGION
python3 seed_settings.py              --region $DYNAMODB_REGION
python3 seed_audit_approvals.py       --region $DYNAMODB_REGION
python3 seed_usage.py                 --region $DYNAMODB_REGION
python3 seed_routing_conversations.py --region $DYNAMODB_REGION
python3 seed_ssm_tenants.py           --region $REGION --stack $STACK_NAME

export S3_BUCKET AWS_REGION=$REGION
python3 seed_skills_final.py
python3 seed_all_workspaces.py        --bucket $S3_BUCKET --region $REGION
python3 seed_knowledge_docs.py        --bucket $S3_BUCKET --region $REGION
```


</details>

### ステップ4-5: 管理コンソール + Gatewayサービス

> **`deploy.sh` がステップ4、4.5、5を自動的に処理します。** Admin Consoleをビルドし、Gatewayサービスをデプロイし、`/etc/openclaw/env` を書き込み、すべてのsystemdサービスを開始します。

<details><summary>手動ステップ (deploy.shを使用しない場合のみ)</summary>

**ステップ4: 管理コンソールのデプロイ**

```bash
cd enterprise/admin-console
npm install && npm run build
cd ../..

COPYFILE_DISABLE=1 tar czf /tmp/admin-deploy.tar.gz -C enterprise/admin-console dist server start.sh
aws s3 cp /tmp/admin-deploy.tar.gz "s3://${S3_BUCKET}/_deploy/admin-deploy.tar.gz"

aws ssm send-command --instance-ids $INSTANCE_ID --region $REGION \
  --document-name AWS-RunShellScript \
  --parameters "{\"commands\":[
    \"python3 -m venv /opt/admin-venv\",
    \"/opt/admin-venv/bin/pip install fastapi uvicorn boto3 requests python-multipart anthropic\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/admin-deploy.tar.gz /tmp/admin-deploy.tar.gz --region $REGION\",
    \"mkdir -p /opt/admin-console && tar xzf /tmp/admin-deploy.tar.gz -C /opt/admin-console\",
    \"chown -R ubuntu:ubuntu /opt/admin-console /opt/admin-venv\",
    \"chmod +x /opt/admin-console/start.sh\",
    \"systemctl daemon-reload && systemctl enable openclaw-admin && systemctl start openclaw-admin\"
  ]}"
```

シークレットをSSMに保存:
```bash
aws ssm put-parameter --name "/openclaw/${STACK_NAME}/admin-password" \
  --value "<YOUR_PASSWORD>" --type SecureString --overwrite --region $REGION
aws ssm put-parameter --name "/openclaw/${STACK_NAME}/jwt-secret" \
  --value "$(openssl rand -hex 32)" --type SecureString --overwrite --region $REGION
```

**ステップ5: Gatewayサービスのデプロイ**

```bash
aws s3 cp enterprise/gateway/tenant_router.py       "s3://${S3_BUCKET}/_deploy/tenant_router.py"
aws s3 cp enterprise/gateway/bedrock_proxy_h2.js    "s3://${S3_BUCKET}/_deploy/bedrock_proxy_h2.js"
aws s3 cp enterprise/gateway/bedrock-proxy-h2.service "s3://${S3_BUCKET}/_deploy/bedrock-proxy-h2.service"
aws s3 cp enterprise/gateway/tenant-router.service  "s3://${S3_BUCKET}/_deploy/tenant-router.service"

aws ssm send-command --instance-ids $INSTANCE_ID --region $REGION \
  --document-name AWS-RunShellScript \
  --parameters "{\"commands\":[
    \"pip3 install boto3 requests\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/tenant_router.py /home/ubuntu/tenant_router.py --region $REGION\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/bedrock_proxy_h2.js /home/ubuntu/bedrock_proxy_h2.js --region $REGION\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/bedrock-proxy-h2.service /etc/systemd/system/bedrock-proxy-h2.service --region $REGION\",
    \"aws s3 cp s3://${S3_BUCKET}/_deploy/tenant-router.service /etc/systemd/system/tenant-router.service --region $REGION\",
    \"systemctl daemon-reload && systemctl enable bedrock-proxy-h2 tenant-router && systemctl start bedrock-proxy-h2 tenant-router\"
  ]}"
```

</details>

### ステップ6: 管理コンソールへのアクセス

```bash
aws ssm start-session --target $INSTANCE_ID --region $REGION \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8099"],"localPortNumber":["8199"]}'
```

**http://localhost:8199** を開き、従業員ID `emp-jiade` (admin) と `.env` からの `ADMIN_PASSWORD` でログイン。初回ログイン時にパーソナルパスワードの設定が必要。

> **パブリックアクセス:** EC2にElastic IPを持つCloudFrontを使用。正しいDigital Twin URL用に `/etc/openclaw/env` に `PUBLIC_URL` を設定 (例: `PUBLIC_URL=https://your-domain.com`) — 管理コンソールはsystemdサービスの `EnvironmentFile` 経由でこのファイルを読み取ります。

### ステップ7: IMチャネルの接続 (オプション)

```bash
# ゲートウェイトークンの取得
aws ssm get-parameter --name "/openclaw/${STACK_NAME}/gateway-token" \
  --with-decryption --query Parameter.Value --output text --region $REGION

# ゲートウェイUIを開く
aws ssm start-session --target $INSTANCE_ID --region $REGION \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["18789"],"localPortNumber":["18789"]}'
# http://localhost:18789/?token=<token>
```

従業員はPortal → Connect IM (QRコード) 経由でセルフサービスでペアリング。管理者承認不要。

---

## テストすべきこと

### 1. SOUL Injection (コアの差別化要因)
**Carol Zhang** (emp-carol、Finance) としてログイン → Chat → "Who are you?" → **"ACME Corp Finance Analyst"**
**Ryan Park** (emp-ryan、SDE) としてログイン → Chat → "Who are you?" → **"ACME Corp Software Engineer"**
同じLLM。完全に異なるアイデンティティ。

### 2. Digital Twin
任意の従業員としてログイン → **Portal → My Profile → Digital Twin トグル**
ONに切り替え → URLをコピー → シークレットモードで開く → その従業員のAI版とチャット
OFFに切り替え → シークレットタブは即座に404

### 3. 組織ディレクトリ (ナレッジベース)
任意のエージェントに質問: *"コードレビューには誰に連絡すべきですか?"* または *"Marcus Bellは何をしますか?"*
→ エージェントは `kb-org-directory` (すべての役職にシード) を読み、適切な人の名前、役割、IMチャネル、エージェント機能で回答

### 4. 権限境界 (4ティア)
Carol Zhang (Restricted): "Run git status" → **拒否** (Finance、shellなし)
Ryan Park (Engineering): "Run git status" → **実行** (SDE、shellあり)
Peter Wu (Executive): 任意のコマンド → **実行** (Executiveティア、Sonnet 4.6)

### 5. マルチランタイム
**Peter Wu** (emp-peter) または **JiaDe Wang** (emp-jiade) としてログイン → これらはExecutive AgentCore Runtimeにルーティング:
- モデル: Claude Sonnet 4.6 (標準のNova 2 Liteと対比)
- ツール: すべてアンロック
- IAM: 完全なS3、すべてのBedrockモデル、部門横断DynamoDB

### 6. メモリの永続化
**JiaDe Wang** (Discord) としてチャット → 15分後に戻る → **エージェントは以前の会話を覚えている**
Discord、Telegram、Portal間で同じメモリを共有。

> **動作の仕組み:** 各ターンは応答後すぐにS3に同期されます(セッション終了時のみではない)。次のmicroVMはセッション開始時にワークスペースをダウンロードし、完全なコンテキストを持っています。メモリが表示されない場合は、`seed_all_workspaces.py` を再実行してS3ワークスペース状態をリセットしてください。

### 7. IMチャネル管理 (管理者)
管理コンソール → **IM Channels** → Discordタブを選択 → JiaDe、David、Peterが接続されているのを確認
→ ペアリング日、セッション数、最終アクティブを表示
→ 任意の従業員で **Disconnect** をクリック

### 8. Security Center
Security Center → **Infrastructureタブ** → 実際のECRイメージ、IAMロール、VPCセキュリティグループを表示
Security Center → **Runtimes → Position Assignments** → 役職がルーティングされるランタイムを変更

### 9. エージェント設定
Agent Factory → **Configurationタブ** → ソリューションアーキテクトにSonnet 4.5を設定
→ Executive役職に `recentTurnsPreserve: 20` を設定
→ 任意の役職に `language: 中文` を設定 → エージェントはデフォルトで中国語

### 11. Bedrock Guardrails (L5コンテンツポリシー)

Standard Runtimeには環境変数として `GUARDRAIL_ID` が設定されています。すべての呼び出しは `server.py` の2つのチェックを通過します: OpenClawに転送する前に `apply_guardrail(source=INPUT)`、応答を返す前に `apply_guardrail(source=OUTPUT)`。いずれかのチェックが `GUARDRAIL_INTERVENED` を返した場合、ユーザーはエージェントの回答の代わりに設定された `blockedMessaging` を受け取ります — ブロックされた入力に対してOpenClawは呼び出されることすらありません。

Exec Runtimeには `GUARDRAIL_ID` がない — チェックは完全にスキップされます。同じ質問、2つの異なるランタイム、2つの異なる結果。すべてのブロックは `guardrail_block` 監査イベントとしてDynamoDBに書き込まれ、**Audit Center → Guardrail Events** で確認できます。

任意のランタイムにガードレールを割り当てるには: **Security Center → Runtimes → Configure** → Guardrailドロップダウンから選択。新しいガードレールを作成するには: `aws bedrock create-guardrail ...` を実行すると、ドロップダウンに自動的に表示されます。

### 10. ナレッジベース割り当て
Knowledge Base → **Assignmentsタブ** → すべての役職にデフォルトでこれらのKBが事前割り当てされています:

| KB | スコープ | エージェントが取得するもの |
|----|-------|----------------|
| `kb-org-directory` | すべて | 完全な従業員ディレクトリ — 誰が何をするか、連絡方法 |
| `kb-policies` | すべて | データ取り扱い、セキュリティベースライン、行動規範 |
| `kb-onboarding` | すべて | 新入社員チェックリスト、セットアップガイド |
| `kb-arch` / `kb-runbooks` | Engineering | アーキテクチャ標準、Runbook |
| `kb-finance` | Finance | 財務報告と方針 |
| `kb-hr` | HR | HR方針 |

新しいKBを追加するには: 管理コンソール → Knowledge Base → Markdownをアップロード → Assignmentsタブ → 役職に割り当て → エージェントは次回コールドスタート時に取得します。

## シードアカウント

> シードデータは11役職にまたがる20人の従業員を作成します。役割は `seed_roles.py` によって割り当てられます: 2人のadmin、3人のmanager、15人のemployee。すべてが初期 `ADMIN_PASSWORD` を共有し、初回ログイン時に変更する必要があります。

| 従業員ID | 名前 | 役割 | 役職 | 部門 | Runtime Tier | チャネル |
|-------------|------|------|----------|------|-------------|----------|
| **emp-jiade** | **JiaDe Wang** | **admin** | Solutions Architect | Engineering | Executive | Discord, Slack |
| **emp-chris** | **Chris Morgan** | **admin** | DevOps Engineer | Platform Team | Engineering | Slack, Telegram |
| emp-alex | Alex Rivera | manager | Product Manager | Product | Standard | Slack |
| emp-mike | Mike Johnson | manager | Account Executive | Enterprise Sales | Standard | WhatsApp, Slack |
| emp-jenny | Jenny Liu | manager | HR Specialist | HR & Admin | Standard | Slack |
| emp-peter | Peter Wu | employee | Executive | Engineering | Executive | Discord |
| emp-ryan | Ryan Park | employee | Software Engineer | Backend Team | Engineering | Slack, Discord |
| emp-carol | Carol Zhang | employee | Finance Analyst | Finance | Restricted | Slack, Telegram |
| emp-rachel | Rachel Li | employee | Legal Counsel | Legal & Compliance | Restricted | Slack |
| emp-emma | Emma Chen | employee | Customer Success Manager | Customer Success | Standard | Slack, WhatsApp |
| emp-marcus | Marcus Bell | employee | Solutions Architect | Engineering | Executive | Slack, Telegram |
| emp-sophie | Sophie Turner | employee | Software Engineer | Backend Team | Engineering | Slack |
| emp-nathan | Nathan Brooks | employee | Software Engineer | Frontend Team | Engineering | Slack |
| emp-lisa | Lisa Chen | employee | DevOps Engineer | Platform Team | Engineering | Slack |
| emp-tony | Tony Reed | employee | QA Engineer | QA Team | Engineering | Slack |
| emp-sarah | Sarah Kim | employee | Account Executive | Enterprise Sales | Standard | WhatsApp |
| emp-tom | Tom Wilson | employee | Account Executive | SMB Sales | Standard | Slack |
| emp-priya | Priya Patel | employee | Product Manager | Product | Standard | Slack, Discord |
| emp-david | David Park | employee | Finance Analyst | Finance | Restricted | Slack |
| emp-daniel | Daniel Kim | employee | Solutions Architect | Engineering | Executive | Slack |

**Runtimeティア割り当て** (Security Center → Position → Runtimeマッピング経由):
- **Executive**: Solutions Architect (pos-sa)
- **Engineering**: Software Engineer (pos-sde)、DevOps Engineer (pos-devops)、QA Engineer (pos-qa)
- **Restricted**: Finance Analyst (pos-fa)、Legal Counsel (pos-legal)
- **Standard**: Account Executive (pos-ae)、Product Manager (pos-pm)、HR Specialist (pos-hr)、Customer Success Manager (pos-csm)、Executive (pos-exec)

## 環境変数

### .env (deploy.shの入力)

| 変数 | 必須 | デフォルト | 説明 |
|----------|----------|---------|-------------|
| `STACK_NAME` | はい | `openclaw-enterprise` | すべてのAWSリソースに名前を付ける。アカウント/リージョンごとに一意。 |
| `REGION` | はい | `us-east-1` | AWSリージョン (Bedrock + AgentCore必要: `us-east-1` または `us-west-2`) |
| `ADMIN_PASSWORD` | はい | — | すべてのアカウントの初期パスワード。SSM SecureStringに保存。従業員は初回ログイン時に変更必須。 |
| `JWT_SECRET` | いいえ | 自動生成 | JWT署名キー。空の場合、`openssl rand -hex 32` で自動生成。 |
| `MODEL` | いいえ | `global.amazon.nova-2-lite-v1:0` | 標準エージェントのデフォルトBedrockモデルID |
| `INSTANCE_TYPE` | いいえ | `c7g.large` | EC2 Graviton ARMインスタンスタイプ |
| `KEY_PAIR` | いいえ | — | 緊急SSH用のEC2キーペア名 |
| `EXISTING_VPC_ID` | いいえ | — | 新規作成の代わりに既存のVPCを再利用 |
| `EXISTING_SUBNET_ID` | いいえ | — | 既存のサブネットを再利用 |
| `CREATE_VPC_ENDPOINTS` | いいえ | `false` | Bedrock/SSM VPCエンドポイントを追加 (約$22/月) |
| `DYNAMODB_TABLE` | いいえ | STACK_NAMEと同じ | テーブル名 — **STACK_NAMEと等しい必要あり** (IAMポリシーは `table/${StackName}` にスコープ) |
| `DYNAMODB_REGION` | いいえ | `us-east-2` | `REGION` と異なる場合のDynamoDBリージョン |
| `WORKSPACE_BUCKET_NAME` | いいえ | 自動 | S3バケット名 — 同じアカウントで複数スタックの場合に設定 |
| `SKIP_DOCKER_BUILD` | いいえ | `false` | Dockerビルドステップをスキップ (既存のイメージを使用) |
| `SKIP_SEED` | いいえ | `false` | DynamoDBシードをスキップ |

### ランタイム変数 (deploy.shにより /etc/openclaw/env に書き込まれる)

| 変数 | 説明 |
|----------|-------------|
| `PUBLIC_URL` | Digital TwinリンクのベースURL — 正しいtwin URLのために **これを設定** |
| `GATEWAY_INSTANCE_ID` | always-onコンテナ管理用のEC2インスタンスID。IMDSv2にフォールバック。 |
| `CONSOLE_PORT` | Admin Consoleポート (デフォルト: `8099`) |
| `TENANT_ROUTER_URL` | Tenant Router URL (デフォルト: `http://localhost:8090`) |
| `ECS_CLUSTER_NAME` | Fargate always-onエージェント用のECSクラスター |
| `ECS_TASK_DEFINITION` | Fargateタスク定義ARN |
| `ECS_SUBNET_ID` | Fargateタスク用のサブネット |
| `ECS_TASK_SG_ID` | Fargateタスク用のセキュリティグループ |

## サンプル組織

| | 数 | 詳細 |
|-|-------|---------|
| 部門 | 13 | 5 Engineering (Platform/Backend/Frontend/QA)、3 Sales (Enterprise/SMB)、Product、Finance、HR、CS、Legal |
| 役職 | 11 | SA、SDE、DevOps、QA、AE、PM、FA、HR、CSM、Legal、Executive |
| 従業員 | 20 | 2 admin、3 manager、15 employee — 各S3にワークスペースファイルあり |
| エージェント | 20 | 従業員に1:1バインド、サーバーレス(デフォルト)+ always-on(管理者トグル) |
| Runtime | 4 | Standard、Restricted、Engineering、Executive (ティアごとのモデル + IAM + ガードレール) |
| IMチャネル | 4 | Slack (ほとんどの従業員)、Discord、Telegram、WhatsApp |
| スキル | 5 | S3ベースのスキルパッケージ (jina-reader、deep-researchなど) |
| 知識ドキュメント | 11 | トピックKB (org-directory、policies、onboarding、arch、runbooks、finance、HR) |
| SOULテンプレート | 12 | 1グローバル + 11役職固有 |
| RBACロール | 3 | Admin (2)、Manager (3)、Employee (15) |
| シードスクリプト | 11 | seed_dynamodb、seed_roles、seed_settings、seed_knowledge、seed_skillsなど |

## コスト見積もり

### AgentCoreコスト (50従業員、サーバーレス)

| コンポーネント | 月額コスト | 注意 |
|-----------|-------------|-------|
| AgentCoreセッション | 約$100〜150 | セッションメモリアイドル ($88) + 呼び出しCPU (約$20〜50) |
| DynamoDB | 約$1 | 従量課金 |
| S3 | $1未満 | ワークスペース、KB、組織ディレクトリ |
| Bedrock (Nova 2 Lite) | 約$5〜15 | 約100会話/日 |

### Always-onエージェント (ECS Fargate、オプション)

| コンポーネント | 月額コスト | 注意 |
|-----------|-------------|-------|
| エージェントごとのFargate | 約$17 | 0.5 vCPU + 1 GB、ARM64 Graviton、24/7 |
| EFS | 約$7 | エラスティックスループット + ストレージ |

### Gatewayインフラ

Gatewayレイヤー(Tenant Router、H2 Proxy、Admin Console)はEC2または同等のコンピュート上で実行されます。単一の `c7g.large` (約$52/月) は開発と小規模デプロイメントに十分です。本番環境では、顧客の可用性要件に基づいてHAアーキテクチャ(ALB + Auto Scaling GroupまたはECS)を使用する必要があります。

### 合計見積もり

| シナリオ | AgentCore | Always-on | Gateway | Bedrock | **合計** |
|----------|-----------|-----------|---------|---------|-----------|
| 50従業員、サーバーレスのみ | $100〜150 | — | 約$52+ | 約$10 | **約$160〜220/月** |
| + 2 always-onエージェント | $100〜150 | $48 | 約$52+ | 約$10 | **約$210〜260/月** |

ChatGPT Team ($25 × 50 = $1,250/月) またはCopilot ($30 × 50 = $1,500/月) と比較。

**AgentCore価格の利点:** CPUやメモリを事前に割り当てる必要なし — インスタンスサイジングの決定なし。アイドルセッションはメモリのみのコスト ($0.00945/GB時間)。誰もチャットしていない場合、CPUは$0。

## プロジェクト構造

```
enterprise/
├── README.md
├── TESTING.md                      # 包括的なテスト計画 (62+テストケース)
├── deploy.sh                       # ワンクリックデプロイメント (8ステップ + Fargateティアセットアップ)
├── clawdbot-bedrock-agentcore-multitenancy.yaml  # CloudFormation
├── admin-console/
│   ├── src/
│   │   ├── types/index.ts          # TypeScript型 (DeployMode、Tier、AlwaysOnStatusなど)
│   │   ├── contexts/
│   │   │   └── PortalAgentContext.tsx  # グローバルエージェントタイプスイッチャー (Serverless / Always-On)
│   │   └── pages/
│   │       ├── Dashboard.tsx           # セットアップチェックリスト + リアルタイム統計
│   │       ├── AgentFactory/           # デュアルエージェントタブ + 設定
│   │       ├── SecurityCenter.tsx      # Fargateカード管理 + ランタイム設定
│   │       ├── IMChannels.tsx          # チャネルごとの従業員管理
│   │       ├── Knowledge/index.tsx     # KB管理 + Assignmentsタブ
│   │       ├── Usage.tsx               # 課金 + Fargateコストカード
│   │       ├── Settings.tsx            # アカウント、Logs、Assistant、Fargate設定タブ
│   │       ├── TwinChat.tsx            # パブリックDigital Twinページ (認証なし)
│   │       └── portal/
│   │           ├── Chat.tsx            # エージェントモードバッジ + ウォームアップインジケーター
│   │           ├── BindIM.tsx          # ペアリング (サーバーレス) + 認証情報フォーム (always-on)
│   │           ├── MyAgents.tsx        # デュアルエージェントカード
│   │           ├── MySkills.tsx        # agent_type対応スキルリスト
│   │           ├── MyUsage.tsx         # agent_type対応使用量
│   │           ├── MyRequests.tsx      # ツール/スキルアクセスリクエスト
│   │           └── Profile.tsx         # USER.md + メモリ + Digital Twin + デプロイモード
│   └── server/
│       ├── main.py                 # アプリブートストラップ — CORS、認証ミドルウェア
│       ├── auth.py                 # JWT認証 + UserContext
│       ├── db.py                   # DynamoDBシングルテーブル + Digital Twin CRUD
│       ├── password.py             # bcryptパスワードハッシュ化
│       ├── routers/                # 17ドメインルーター (130+ APIエンドポイント)
│       │   ├── org.py agents.py bindings.py knowledge.py
│       │   ├── portal.py playground.py monitor.py audit.py
│       │   ├── usage.py settings.py security.py
│       │   ├── admin_im.py admin_ai.py admin_always_on.py
│       │   ├── gateway_proxy.py twin.py
│       │   └── __init__.py
│       └── seed_*.py               # サンプルデータスクリプト
├── agent-container/                # AgentCore Dockerイメージ (OpenClaw 2026.3.24)
│   ├── Dockerfile                  # 固定 openclaw@2026.3.24 + 4スキル
│   ├── server.py                   # HTTPサーバー: ワークスペース組み立て + 呼び出し + 使用量追跡
│   ├── entrypoint.sh               # コンテナ起動: SSM登録、IM自動接続
│   ├── workspace_assembler.py      # 3レイヤーSOULマージ + KB注入 + アイデンティティ
│   ├── permissions.py              # SSM権限プロファイル (base_id抽出)
│   ├── skill_loader.py             # DynamoDB役割ルックアップ → スキルフィルタリング
│   ├── identity.py                 # 従業員アイデンティティ注入
│   ├── memory.py                   # ターンごとのメモリチェックポイント
│   ├── observability.py            # CloudWatchメトリクス
│   ├── safety.py                   # ガードレール強制
│   ├── openclaw.json               # エージェント設定 (組み込みcron/gatewayを拒否)
│   └── skills/                     # エンタープライズスキル (eventbridge-cronなど)
├── exec-agent/                     # ExecutiveティアDockerイメージ
│   ├── Dockerfile                  # 固定 openclaw@2026.3.24 + 20スキル、Sonnet 4.6
│   └── openclaw.json               # Executive設定 (完全なツール権限)
├── auth-agent/                     # 権限/承認エージェント
│   ├── server.py                   # 承認ワークフローHTTPサーバー
│   └── permission_request.py       # 権限リクエストハンドラー
├── gateway/
│   ├── bedrock_proxy_h2.js         # H2 Proxy (チャネル検出、ペアリングインターセプト)
│   └── tenant_router.py            # 3ティアルーティング + always-onコンテナサポート
└── docs/
    ├── environments.md             # 環境レジストリ (prod、test、legacy)
    └── worklog-*.md                # 開発セッションログ
```

## 運用ノート

### Always-onエージェント管理 (ECS Fargate)

Always-onエージェントは、EFSバックアップ永続ワークスペースとクラッシュ時の自動再起動を持つ **ECS Fargate Services** として実行されます。各タスクは起動時にプライベートVPC IPをSSMに自己登録します; Tenant Routerはそのバージョンを読み取ってリクエストをルーティングします。管理者はAgent Factoryでエージェントを作成する際にデプロイメントモード (サーバーレスまたはAlways-on) を選択します。

**Agent Factory → エージェント詳細 → デプロイメントモードトグル** から開始/停止、または手動:

```bash
# CloudFormation出力からECS設定を読み取る (一度きりのセットアップ)
ECS_CLUSTER=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`AlwaysOnEcsClusterName`].OutputValue' --output text)
ECS_TASK_DEF=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`AlwaysOnTaskDefinitionArn`].OutputValue' --output text)
ECS_SUBNET=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`AlwaysOnSubnetId`].OutputValue' --output text)
ECS_SG=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`AlwaysOnTaskSecurityGroupId`].OutputValue' --output text)

# Admin Consoleが使用できるように /etc/openclaw/env に書き込む
aws ssm send-command --instance-ids $INSTANCE_ID --region $REGION \
  --document-name AWS-RunShellScript \
  --parameters "{\"commands\":[
    \"echo 'ECS_CLUSTER_NAME=${ECS_CLUSTER}' >> /etc/openclaw/env\",
    \"echo 'ECS_TASK_DEFINITION=${ECS_TASK_DEF}' >> /etc/openclaw/env\",
    \"echo 'ECS_SUBNET_ID=${ECS_SUBNET}' >> /etc/openclaw/env\",
    \"echo 'ECS_TASK_SG_ID=${ECS_SG}' >> /etc/openclaw/env\",
    \"systemctl restart openclaw-admin\"
  ]}"

# 手動ECS RunTask (UI利用不可の場合)
aws ecs run-task \
  --cluster $ECS_CLUSTER \
  --task-definition $ECS_TASK_DEF \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$ECS_SUBNET],securityGroups=[$ECS_SG],assignPublicIp=ENABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"always-on-agent\",\"environment\":[
    {\"name\":\"SHARED_AGENT_ID\",\"value\":\"agent-helpdesk\"},
    {\"name\":\"SESSION_ID\",\"value\":\"shared__agent-helpdesk\"},
    {\"name\":\"S3_BUCKET\",\"value\":\"$S3_BUCKET\"},
    {\"name\":\"STACK_NAME\",\"value\":\"$STACK_NAME\"},
    {\"name\":\"AWS_REGION\",\"value\":\"$REGION\"}
  ]}]}" \
  --region $REGION
```

タスクのプライベートIPは、ヘルシーになると(約30秒)`entrypoint.sh` によって `/openclaw/{stack}/always-on/{agent_id}/endpoint` としてSSMに自動的に登録されます。Tenant Routerは60秒以内にそれを取得します (SSMキャッシュTTL)。

### Digital Twinパブリックpurl

`/etc/openclaw/env` に `PUBLIC_URL` を設定 — 管理コンソールsystemdサービスはこのファイルを自動的に読み取ります:
```bash
echo "PUBLIC_URL=https://your-domain.com" >> /etc/openclaw/env
sudo systemctl restart openclaw-admin
```

### エージェントDockerイメージの更新

ビルドごとに、新しい `:latest` ダイジェストを解決するためにAgentCore Runtimeを更新します:

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id "$RUNTIME_ID" \
  --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${ECR_URI}\"}}" \
  --role-arn "$EXECUTION_ROLE_ARN" \
  --network-configuration '{"networkMode":"PUBLIC"}' \
  --environment-variables "{\"BEDROCK_MODEL_ID\":\"global.amazon.nova-2-lite-v1:0\", ...}" \
  --region $REGION
```

**常に `--environment-variables` を渡す** — フィールドが省略されている場合、AgentCoreは環境変数をクリアします。

**Session Storage警告:** `update-agent-runtime` はそのランタイムのすべてのSession Storageを消去します。すべての従業員のセッションは、次の呼び出し時にS3からブートストラップされます (セッション再開の約2〜3秒の代わりに約6秒のコールドスタート)。これは予想されており、自動的に処理されます — S3は常に管理者管理ファイルの真実の情報源です。

### リマインダーとスケジュールタスク

OpenClawのリマインダーシステムは、エージェントのワークスペースに `HEARTBEAT.md` を書き込み、スケジュールされた時刻にアクティブなチャネルを通じて通知を送信します。

| デプロイメントモード | リマインダー動作 |
|----------------|-----------------|
| **Always-on (ECS Fargate)** | 完全サポート — コンテナは永続的、ハートビートはスケジュール通りに発火。配信チャネルはワークスペースの `CHANNELS.md` から読み取られる (セッション開始時にIMペアリングから自動注入)。**これがalways-onモードの主要なユースケース** — カスタマーサービスポーリング、3分ごとのメールチェック、毎日のレポート生成。 |
| **Serverless (AgentCore)** | ハートビートが設定され、`HEARTBEAT.md` がSession Storageに永続化されS3に同期。microVMが再開するときに **次のセッション開始時に** 発火。スケジュールされた時刻の前に新しいメッセージが届かない場合、リマインダーは次の相互作用まで延期される。 |

**信頼性の高いスケジュールタスクのため:** Agent Factoryからエージェントをalways-onモードに切り替えます。これは、バックグラウンドタスク (メール監視、チケットスキャン、定期レポート) を実行する必要があるエージェントの推奨アプローチです。

`CHANNELS.md` は、セッション組み立て中に各従業員のワークスペースに自動的に書き込まれます (SSM IMペアリングの逆引き)。ユーザーがIMチャネルをペアリングしたら、手動設定は不要です。

### H2 ProxyとTenant Router — systemdサービス

```bash
sudo cp gateway/bedrock-proxy-h2.service /etc/systemd/system/
sudo cp gateway/tenant-router.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bedrock-proxy-h2 tenant-router
sudo systemctl start bedrock-proxy-h2 tenant-router
```

## トラブルシューティング

### CloudFormationスタック削除がPrivateSubnetで失敗

**症状:** `aws cloudformation delete-stack` がスタックし、次のように `DELETE_FAILED` を報告:
```
The subnet 'subnet-xxx' has dependencies and cannot be deleted.
```

**原因:** AWS GuardDutyは、監視するすべてのサブネットに管理対象VPCエンドポイントを自動的に作成します。これらのエンドポイントがサブネットの削除をブロックします。

**修正:** 再試行する前にGuardDuty管理エンドポイントを見つけて削除:

```bash
# スタックのVPC内のGuardDutyエンドポイントを見つける
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:aws:cloudformation:stack-name,Values=${STACK_NAME}" \
  --region $REGION --query 'Vpcs[0].VpcId' --output text)

ENDPOINTS=$(aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --region $REGION \
  --query 'VpcEndpoints[?State!=`deleted`].VpcEndpointId' --output text)

aws ec2 delete-vpc-endpoints --vpc-endpoint-ids $ENDPOINTS --region $REGION

# スタック削除を再試行
aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION
```

> **注意:** これはGuardDutyを無効にしません — 削除をブロックしていたエンドポイントENIを削除するだけです。GuardDutyは新しいサブネットに自動的に再作成します。

> **予防:** `CreateVPCEndpoints=false` (デフォルト) でデプロイすると、このテンプレートでGuardDutyが一貫して接続する唯一のサブネットであるPrivateSubnetの作成を回避できます。CloudFormationテンプレートは、VPCエンドポイントが無効な場合にPrivateSubnetの作成をスキップするように更新されました。

### `deploy.sh` が失敗: `--skip-build` 後にECRリポジトリが空

**症状:** AgentCoreランタイム作成が "specified image identifier does not exist." で失敗。

**原因:** `--skip-build` はDockerビルドをスキップしますが、これが新しいスタックの初回デプロイの場合、ECRリポジトリは空になります。

**修正:** 初回デプロイ時は `--skip-build` なしで実行。スクリプトはSSM経由でゲートウェイEC2上でビルドします — ローカルDocker不要。

### AgentCoreがすべてのメッセージでHTTP 500を返す

**原因:** ほぼ常にコンテナ内の `openclaw` npmパッケージのバージョンが間違っている。

**確認:**
```bash
aws logs tail /aws/bedrock-agentcore/runtimes/<runtime-id>-DEFAULT --follow
# 探す: "openclaw returned empty output"
```

**修正:** Dockerイメージを再ビルド。`agent-container/Dockerfile` と `exec-agent/Dockerfile` の両方が `openclaw@2026.3.24` を正確にインストールする必要があります — アップグレードしないでください。

---

[wjiad@aws](mailto:wjiad@amazon.com) によって構築 · [aws-samples](https://github.com/aws-samples) · 貢献を歓迎します
