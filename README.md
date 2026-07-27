# gdrive-cli

Truy cập Google Sheets / Docs / Slides / Drive bằng **service account**, cho Claude Code và
cho script Node — **zero dependency**.

Cài một lần bằng `npx`, dùng được ở **mọi repo**.

> Trạng thái: đang phát triển. Phase 0 (lõi API) và Phase 1 (đọc OOXML) đã xong và có test;
> CLI + wizard cài đặt (Phase 2) chưa có.

## Vì sao zero dependency

| | |
|---|---|
| `googleapis` | **207 MB** giải nén |
| gói này | 0 dependency |

Auth là JWT RS256 tự ký bằng `node:crypto` rồi đổi lấy access token (~170 dòng). Đọc
`.xlsx/.docx/.pptx` là ZIP + XML, dùng `zlib.inflateRawSync` có sẵn trong Node (~600 dòng).
Không có gì cần cài thêm — kể cả `python3` + `openpyxl` mà cách làm cũ phải dựa vào.

## Đọc được những gì

| Định dạng | Đọc | Cách |
|---|---|---|
| Google Sheets | ✅ | Sheets API (**không** export CSV — CSV chỉ ra tab đầu) |
| Google Docs | ✅ | `files.export` → `text/markdown` |
| Google Slides | ✅ | export `.pptx` rồi tự parse (export `text/plain` mất ranh giới slide) |
| `.xlsx` / `.xlsm` | ✅ | ZIP + XML |
| `.docx` | ✅ | ZIP + XML (kèm bảng → markdown) |
| `.pptx` | ✅ | ZIP + XML, giữ từng slide |
| `.csv` `.txt` `.md` `.json` | ✅ | tải thẳng |
| PDF | ⚠️ tải về | Không parse — tải xuống rồi để công cụ đọc PDF xử lý |
| `.doc` `.xls` `.ppt` (đời cũ) | ❌ | Từ chối kèm hướng dẫn: mở trong Drive → File → Save as Google Docs |

`.doc/.xls/.ppt` là OLE2/CFB nhị phân. Parser đúng tốn hàng nghìn dòng, còn parser nửa vời
trả ra rác *trông có vẻ đúng* — kiểu hỏng tệ nhất khi kết quả sẽ được dùng để ra quyết định.

## Credential

Tìm theo thứ tự, dừng ở cái đầu tiên có:

1. Tham số truyền thẳng vào `createClient({credentials})`
2. `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON thô hoặc base64) ← thân thiện CI nhất
3. `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`
4. `DRIVE_SERVICE_ACCOUNT_EMAIL` + `DRIVE_PRIVATE_KEY`
5. `GOOGLE_APPLICATION_CREDENTIALS` (đường dẫn file key)
6. `~/.claude/gdrive.json` (do wizard ghi, chmod 600)
7. ADC của gcloud
8. `gcloud auth print-access-token`

Env đứng trước file config là cố ý: CI không có `~/.claude` nhưng có secret trong env.

> **Service account là một danh tính riêng, có email riêng.** Nó không thấy gì cho tới khi
> bạn Share file/folder cho email đó — Viewer để đọc, Editor để ghi.

> **Service account không có dung lượng My Drive.** Mọi thao tác GHI file vào My Drive đều
> thất bại `403 storageQuotaExceeded`, kể cả khi đã share Editor. Muốn upload thì phải dùng
> Shared Drive.

## Dùng như thư viện

```js
import { createClient, readSheet, parseGoogleUrl } from 'gdrive-cli';

const client = createClient({ mode: 'readonly' });
const { id, gid } = parseGoogleUrl('https://docs.google.com/spreadsheets/d/…/edit#gid=123');
const { rows, sheet, sheets } = await readSheet(client, id, { gid });
```

Có sẵn facade mang hình dạng client `googleapis` để migrate code cũ mà không phải sửa chỗ gọi:

```js
import { createSheetsCompatClient } from 'gdrive-cli/sheets-compat';

const sheets = createSheetsCompatClient({ mode: 'readwrite' });
await sheets.spreadsheets.values.get({ spreadsheetId, range: "'Tab'!A1:C3" }); // → {data}
```

## Test

```bash
node --test
```

115 test, không cần mạng và không cần credential: chữ ký JWT được verify bằng keypair sinh
tại chỗ, fixture ZIP/OOXML dựng in-memory bằng `zlib.deflateRawSync`.

Ngoài ra bộ đọc `.xlsx` đã được đối chiếu với `python3` + `openpyxl` trên 6 file thật tải từ
Drive: **3859 ô, 0 lệch**.

## Giấy phép

MIT
