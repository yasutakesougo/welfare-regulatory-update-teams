# Slice A — Evidence Normalization implementation

## Scope basis

実装範囲は GitHub Issue #4 と、その Scope Correction-1 / Scope Correction-2 を正本とする。

Slice A は、公式一次情報として与えられた入力を Evidence Contract に正規化する。

Slice A は外部サイトを取得しない。

Slice A は Teams、SharePoint、Microsoft 365 に書き込まない。

Slice A は `VERIFIED_OFFICIAL` を生成しない。

## ContentHash V1

`ContentHash` は `rawContent` の exact UTF-8 bytes に対する SHA-256 とする。

出力は lowercase hexadecimal string とする。

空白、改行、Unicode、意味内容の正規化は行わない。

## EvidenceStatus

Slice A の出力は次に固定する。

```text
OFFICIAL_PENDING_REVIEW
```

公式確認済みへの遷移は後続の Human Review / Evidence Verification scope で扱う。

## CanonicalSourceUrl

`canonicalSourceUrl` が入力された場合は、その値をそのまま保持する。

入力されない場合は `sourceUrl` をそのまま `CanonicalSourceUrl` に使用する。

この fallback は、外部世界で唯一の canonical URL であることを意味しない。

## Comparison

```text
priorEvidence absent => NEW
same resolved source identity + same ContentHash => SAME_CONTENT
same resolved source identity + different ContentHash => CONTENT_CHANGED
resolved source identities differ => NEW
identity cannot be resolved safely => IDENTITY_UNRESOLVED
```

比較は prior Evidence を更新、置換、削除しない。

## Validation

Required field の欠損または形式不正は typed validation failure とする。

partial Evidence は返さない。

Unknown input field は V1 では無視する。

raw input を error、log、snapshot へ自動出力しない。

## Non-interference

この Slice は既存リポジトリへ runtime、build、release dependency を追加しない。

Teams / SharePoint / Microsoft 365 credential は不要とする。

Live regulatory fetch、Teams Publication、Production Write は対象外とする。
