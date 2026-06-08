# OIDCシングルサインオン セットアップガイド

OpenClaw Enterpriseは、以下を含む任意のOpenID Connect (OIDC) 互換のIDプロバイダーをサポートしています:

- **Alibaba Cloud IDaaS** (EIAM)
- **Microsoft Entra ID** (Azure AD)
- **Okta**
- **Keycloak**
- その他、標準準拠のOIDCプロバイダー

すべての設定は管理コンソールから **ランタイムで** 行われます。テナントごとの環境変数や再ビルドは不要です。

## 動作の仕組み (BFFアーキテクチャ)

```
ブラウザ                     OpenClawバックエンド          IdP
───────                     ─────────────────             ───

"Sign in with SSO" をクリック
  ↓
GET /api/v1/auth/sso/login
                            state + PKCE verifierを生成
                            HttpOnly Cookieに保存 (10分)
                            ← 302 to IdP /authorize ─────→
                                                          ユーザーが認証
  ← 302 to
   /api/v1/auth/sso/callback?code=...
                            ← Cookieからstateを検証
                            POST /token with client_secret + verifier ──→
                                                          ← id_token
                            JWKS経由でid_tokenを検証 (RS256)
                            メールアドレスをDynamoDB employeeにマッチ
                            (有効な場合は自動プロビジョニング)
                            ローカルHS256 JWTを発行
                            ← 302 to /login/sso-success#token=xxx
  ↓
フロントエンドがURLハッシュからJWTを読み取り
localStorageに保存
/portalまたは/dashboardにリダイレクト
```

**主要な特性:**

- **Backend-for-Frontend (BFF)**: すべてのOAuthインタラクションはサーバーサイドで発生します。ブラウザはIdPのトークンエンドポイントに触れることがないため、**IdP側でCORS設定は不要** です。
- **Confidential Client** with `client_secret` + 多層防御としての **PKCE**。
- **Local JWT** はIdP認証成功後に発行されます — パスワードログインと同じトークン形式なので、認証ミドルウェアは両方を統一的に処理します。
- **localStorageのトークン** (ローカルJWTのみ、IdPトークンではありません)。

## 前提条件

1. 管理アクセス権を持つOIDC互換のIdP
2. 本番環境では、OpenClaw Portalは **HTTPS** 経由でアクセス可能である必要があります (HTTPは `localhost` の場合のみ許可されます)
3. IdPアプリケーションは、Client Secret付きの **Confidential Client** モードをサポートする必要があります (必須 — Public Client / PKCEのみのモードはサポートされていません)

## ステップ1: IdPにOIDCアプリケーションを作成

### 共通設定 (すべてのプロバイダー)

| 設定 | 値 |
|---|---|
| アプリケーションタイプ | **Web Application** / **Confidential Client** (SPAではない) |
| Grant type | **Authorization Code** (PKCEサポートあり) |
| Redirect URI | `https://your-portal.example.com/api/v1/auth/sso/callback` |
| Initiate Login URI (オプション) | `https://your-portal.example.com/login?sso=idp` — IdPイニシエートフローを有効化 |
| Post Logout Redirect URI (オプション) | `https://your-portal.example.com/login` |
| Scope | `openid profile email` |
| IDトークン署名アルゴリズム | RS256 |
| Client Secret必須 | **はい** (IdPコンソールで生成) |

> **重要**: Redirect URIは、フロントエンドルートではなく **バックエンドエンドポイント** (`/api/v1/auth/sso/callback`) を指します。OpenClawはOAuthコールバックを完全にサーバー上で処理します。

### Alibaba Cloud IDaaS

1. IDaaSインスタンスコンソールを開く → **Applications** → **Add Application**
2. **Custom OIDC Application** を選択
3. 設定:
   - **Application Type**: OIDC SSO
   - **Client Type**: Confidential Client / 应用端机密客户端
   - **Authorization Mode**: `authorization_code`
   - **PKCE**: 有効 (S256)
   - **Redirect URI**: `https://your-portal.example.com/api/v1/auth/sso/callback`
   - **Initiate Login URI**: `https://your-portal.example.com/login?sso=idp`
4. 保存後、以下をコピー:
   - **Issuer URL**、例:
     - パブリックエントリ: `https://eiam-api-{region}.aliyuncs.com/v2/{instance_id}/{app_id}/oidc`
     - カスタムドメイン: `https://{prefix}.aliyunidaas.com/api/v2/iauths_system/oauth2`
   - **Client ID** (形式 `app_xxxxxxxxxx`)
   - **Client Secret** (アプリ作成時に1回だけ表示される; 紛失した場合は "Developer Access" / "Keys" セクションで再生成)
5. アクセスが必要な従業員にアプリケーションを認可

### Microsoft Entra ID (Azure AD)

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations**
2. **New registration**
   - **Supported account types**: *Accounts in this organizational directory only*
3. 新しいアプリで、**Authentication** → **Add a platform** → **Web** へ
   - **Redirect URI**: `https://your-portal.example.com/api/v1/auth/sso/callback`
   - **Front-channel logout URL** (オプション): `https://your-portal.example.com/login`
   - implicit/hybridフローのチェックボックスはすべて **オフのまま**
4. **重要**: "Single-page application" プラットフォームを追加しないでください。Azure ADは、SPA登録アプリがトークンをブラウザのみを介して交換することを義務付けており、これはBFFモードと互換性がありません。SPAとWebの両方のプラットフォームが表示される場合は、SPAプラットフォームを削除してください。
5. **Certificates & secrets** → **New client secret**:
   - 説明: 例 `openclaw-sso`
   - 有効期限: 24ヶ月 (推奨)
   - **Add** をクリックし、**すぐにValueをコピー** (1回だけ表示)
6. コピー:
   - **Issuer**: `https://login.microsoftonline.com/{tenant_id}/v2.0`
     (tenant_idはOverview → Directory (tenant) IDから)
   - **Client ID**: Overview → Application (client) ID
   - **Client Secret**: 先ほどコピーした値
7. API permissions → `openid`、`profile`、`email` が付与されていることを確認

### Okta

1. **Applications** → **Create App Integration** → **OIDC - Web Application**
2. 設定:
   - **Grant types**: Authorization Code + Refresh Token (PKCEはデフォルトで有効)
   - **Sign-in redirect URIs**: `https://your-portal.example.com/api/v1/auth/sso/callback`
   - **Sign-out redirect URIs**: `https://your-portal.example.com/login`
   - **Controlled access**: 適切な割り当てポリシーを選択
3. コピー:
   - **Issuer**: `https://{your-okta-domain}/oauth2/default`
   - **Client ID**
   - **Client Secret** (Client Credentialsセクション)

### Keycloak

1. レルムで: **Clients** → **Create client**
2. 設定:
   - **Client type**: OpenID Connect
   - **Client authentication**: **ON** (confidentialクライアント)
   - **Authentication flow**: **Standard flow** のみチェック
   - **Valid redirect URIs**: `https://your-portal.example.com/api/v1/auth/sso/callback`
   - **Valid post logout redirect URIs**: `https://your-portal.example.com/login`
   - **Advanced → Proof Key for Code Exchange Code Challenge Method**: S256
3. 作成後、**Credentials** タブに移動し、**Client secret** をコピー
4. コピー:
   - **Issuer**: `https://{keycloak-host}/realms/{realm-name}`
   - **Client ID**: ステップ1で設定したID
   - **Client Secret**: ステップ3から

## ステップ2: OpenClawでSSOを設定

1. パスワードを使用して **管理アカウント** で管理コンソールにサインイン
2. **Settings** → **SSO** タブに移動
3. 表示される `Redirect URI` と `Initiate Login URI` を確認 — これらはIdPで登録したものと一致する必要があります
4. 入力:
   - **Issuer URL**: IdPコンソールから
   - **Client ID**: IdPコンソールから
   - **Client Secret**: IdPコンソールから
   - **Scopes**: `openid profile email` (デフォルト)
5. **Test Connection** をクリック
   - バックエンドが `{issuer}/.well-known/openid-configuration` を取得
   - 成功はIssuerが到達可能で有効なOIDCメタデータを返すことを意味します
6. **Auto-Provisioning** を設定 (オプション):
   - **Auto-create employees on first SSO login**: デフォルトでオン
   - **Default Position**: 役職リストから選択
   - **Default Role**: `employee` (またはmanager/admin)
7. **Enable SSO** をチェックして、ログインページに "Sign in with SSO" ボタンを表示
8. **Save** をクリック

設定はすぐに有効になります。再起動は不要です。

## ステップ3: 従業員をSSO IDにリンク

バックエンドは、IDトークンの `email` クレームによってSSOユーザーを識別します。SSOユーザーを従業員にリンクするには2つの方法があります:

### オプションA: 自動プロビジョニング (デフォルト、推奨)

**デフォルトで有効**。SSOユーザーが初めてサインインし、一致する従業員が存在しない場合、OpenClawは自動的に以下を作成します:

- 新しい従業員レコード (メールプレフィックスに基づくID、例: `jane.doe@company.com` → `emp-jane.doe`; 衝突した場合は `emp-jane.doe-a3f0` のようなランダムな4文字のサフィックスを取得)
- 設定されたDefault Positionから継承したスキルを持つパーソナルエージェント
- 監査ログエントリ (`eventType: employee_auto_create`、`createdVia: sso_auto`)

初回ログイン後、管理者は **Organization → Employees** または **Agent Factory** を通じて従業員の役職/役割/スキルを調整できます。

### オプションB: 手動プロビジョニング

自動作成を無効にして、誰かがサインインする前に管理者が従業員レコードを手動で作成することを要求します。より厳密な制御のためにこれを使用してください。

**Organization → Employees** → 従業員を追加 → IdPログインに一致するEmailアドレスを設定。

検証ルール (UIとバックエンドの両方で適用):

- メールは **オプション** — SSO経由でサインインしない従業員は空のままにできます
- 提供される場合、有効なメール形式である必要があります
- 組織全体で **一意** である必要があります
- **小文字** で保存されます (大文字小文字を区別しないマッチング)

SSOユーザーがサインインすると:

1. IdPが `email: jane.doe@company.com` でid_tokenを発行
2. OpenClawバックエンドがそのメールを持つ従業員を見つける
3. ユーザーは従業員の役割、部門、エージェントなどでサインインされる

一致する従業員が存在せず、自動作成が無効になっている場合、ユーザーには次のように表示されます:
`SSO 登录成功,但未找到邮箱为 xxx 的员工。请联系管理员。`

## サポートされているログインフロー

### SP-Initiated (ユーザーがPortalから開始)

```
ユーザーが https://portal.example.com を開く
  → /loginにリダイレクトされる
  → "Sign in with SSO" をクリック
  → IdPにリダイレクトされる
  → 認証
  → リダイレクトされて戻り、サインインされる
```

### IdP-Initiated (ユーザーがIdPワークスペースから開始)

`?sso=idp` URLパラメータによって自動的にトリガーされます。IdPで **Initiate Login URI** を `/login?sso=idp` として設定します。

```
ユーザーがIdPワークスペースのOpenClawアイコンをクリック
  → IdPが https://portal.example.com/login?sso=idp にリダイレクト
  → Portalがすぐに SSOログインをトリガー (手動クリック不要)
  → IdPが既存のセッションを認識し、サイレントにトークンを発行
  → ユーザーは手動ステップなしでPortalに到着
```

### パスワード (管理者のフォールバック)

常に利用可能。SSOが誤設定されている場合やIdPに到達できない場合でも、管理者は従業員ID + パスワードでサインインできます。

## トラブルシューティング

| 症状 | 原因 | 修正 |
|---|---|---|
| "Sign in with SSO" をクリック → IdPが "Invalid redirect_uri" を表示 | IdPのRedirect URIがOpenClawのものと正確に一致していない | `https://your-portal.example.com/api/v1/auth/sso/callback` がIdPに登録されていることを確認 (正確なホスト、ポート、プロトコル、パス、末尾スラッシュなし) |
| IdPログインは成功するがエラー "未找到邮箱为 xxx 的员工" | そのメールを持つDynamoDB従業員が存在しない | 自動プロビジョニングを有効にするか、**Organization → Employees** で従業員レコードにメールを追加 |
| エラー "token_exchange_failed" — Azure ADログに `AADSTS9002327` (SPA client-type) が表示 | Azure ADアプリにSPAプラットフォームが設定されている | Azure Portal → AuthenticationでSPAプラットフォームを削除。Webプラットフォームのみを保持。 |
| エラー "token_exchange_failed" — Azure ADログに `AADSTS700025` (Client is public) が表示 | 上記と同じ — SPAプラットフォームがアプリをパブリックにする | 同じ修正 — SPAプラットフォームを削除 |
| エラー "token_exchange_failed" — Azure ADログに `AADSTS7000218` (client_secret required) が表示 | Client Secretが欠落または不正 | IdPコンソールで新しいClient Secretを生成し、OpenClaw Settings → SSOに貼り付け |
| Test Connectionが "HTTP error" で失敗 | バックエンドがIdPに到達できない (ネットワーク/ファイアウォール) | EC2インスタンスがIdPへの送信を持っていることを確認; セキュリティグループとNATを確認 |
| 設定は保存されたがログインがまだ古い設定を使用 | バックエンドのキャッシュ | 問題ではありません — バックエンドは保存時に自動的にキャッシュをクリアします |
| トークンが予期せず期限切れ | id_tokenの有効期間が予想より短い | ユーザーは/loginにリダイレクトされます; 再認証可能です |

## セキュリティに関する注意事項

- **Client SecretによるConfidential Client** — 標準のOAuth 2.0 BFFパターン。シークレットはDynamoDBに保存され、サーバーサイドでのみ使用され、ブラウザに送信されることはありません。
- **PKCEは多層防御として使用** され、client_secret認証の上で、転送中の認可コード傍受から保護します。
- **トークンはブラウザのlocalStorageに保存** (ローカルHS256 JWTのみ) — ログアウト時にクリアされます。IdPが発行したアクセス/リフレッシュトークンはバックエンドから出ることはありません。
- **すべてのトークン検証はサーバーサイド** — バックエンドはIdPのJWKSエンドポイントを使用してRS256署名を検証し、さらに `audience`、`issuer`、`exp` クレームも検証します。
- **本番環境ではHTTPSが必要** — HTTPは `localhost` の場合のみ許可されます。
- **リフレッシュトークン管理なし** — ローカルJWTが期限切れになると、ユーザーは/loginにリダイレクトされます。SSO経由で再度サインインできます (IdPセッションがまだ有効な場合はサイレント) またはパスワードで。
- **CSRF / state** — HttpOnly Cookieに SameSite=Laxで保存; コールバック時に厳密に検証されます。

## SSOの無効化

設定を保持したままSSOをオフにするには:

1. Settings → SSO → **Enable SSO** のチェックを外す → Save

設定を完全に削除するには:

1. Settings → SSO → Issuer/Client ID/Secretをクリア → Enable SSOのチェックを外す → Save

SSOが無効になっている間も、ユーザーはパスワードでサインインできます。
