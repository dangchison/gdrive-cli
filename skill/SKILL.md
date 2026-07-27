---
name: gdrive
description: >-
  Đọc và ghi dữ liệu trên Google Drive bằng service account — Google Sheets, Google Docs,
  Google Slides, và file .xlsx/.docx/.pptx/.csv lưu trên Drive. Dùng khi người dùng dán link
  docs.google.com (spreadsheets/document/presentation) hoặc drive.google.com, hoặc nói "đọc
  sheet này", "lấy dữ liệu từ Google Sheet", "đọc file docx/xlsx/slide trên Drive", "ghi kết
  quả vào sheet", "upload file lên Drive", "tìm file trên Drive", "tải file từ Drive về".
---

# Truy cập Google Drive / Sheets / Docs / Slides

CLI đã cài sẵn trên máy, chạy qua Bash:

```bash
node {{CLI}} <lệnh> [tham số]
```

Mọi lệnh nhận **thẳng URL người dùng dán vào** — không cần tự bóc id hay gid.
Thêm `--json` khi cần dữ liệu để xử lý tiếp thay vì để đọc.

## Chọn lệnh nào

**Chưa chắc file là gì thì chạy `info` trước** — rẻ hơn nhiều so với đoán rồi ăn lỗi:

```bash
node {{CLI}} info "<url>"
```

Nó trả về `kind` và `readAs` (đọc được bằng lệnh nào).

| Loại | Lệnh |
|---|---|
| Google Sheets, `.xlsx` trên Drive | `read` |
| Google Docs, Google Slides, `.docx`, `.pptx`, `.csv`, `.txt`, `.md` | `doc` |
| PDF, ảnh, định dạng khác | `get --out <path>` rồi đọc file đã tải bằng Read tool |
| `.doc` / `.xls` / `.ppt` đời cũ | **không đọc được** — bảo người dùng mở trong Drive → File → Lưu dưới dạng Google Docs |

## Đọc bảng

```bash
node {{CLI}} read "<url>"                       # tab suy ra từ gid trong URL, hoặc tab đầu
node {{CLI}} read "<url>" --sheet "Tên tab"     # theo tên tab
node {{CLI}} read "<url>" --sheet 1932153755    # theo gid
node {{CLI}} read "<url>" --range A1:E50 --max-rows 100
node {{CLI}} read "<url>" --json                # để xử lý tiếp bằng code
```

Kết quả **luôn kèm danh sách tất cả các tab** (tên + gid + kích thước). Nếu đoán nhầm tab,
gọi lại với `--sheet` đúng — không cần lệnh phụ để dò.

`.xlsx` trên Drive được tự nhận và parse tại chỗ; không cần `python3` hay `openpyxl`.

## Đọc văn bản

```bash
node {{CLI}} doc "<url>"                    # markdown (mặc định)
node {{CLI}} doc "<url>" --format text
node {{CLI}} doc "<url>" --notes            # slide: lấy cả ghi chú người trình bày
node {{CLI}} doc "<url>" --max-chars 200000
```

Luôn đọc phần `warnings` trong kết quả và nói lại cho người dùng khi có — ví dụ tài liệu có
header/footer không được trích, hoặc nội dung đã bị cắt bớt. Đừng lặng lẽ bỏ qua.

## Ghi vào Sheet

Chỉ dùng được khi cài ở chế độ read-write.

```bash
node {{CLI}} write "<url>" --set L5=PASSED --set L6=FAILED
node {{CLI}} write "<url>" --sheet "Kết quả" --set B2="Có dấu cách thì bọc nháy"
```

Ô được ghi theo A1 **tương đối với tab**; CLI tự lo phần tên tab và dấu nháy.
Nhiều `--set` gộp thành một lần gọi API, và **chỉ những ô nêu tên mới bị đụng tới**.

## Tìm và chuyển file

```bash
node {{CLI}} ls "<url-thư-mục>"
node {{CLI}} ls --name-contains "roster" --max 20
node {{CLI}} get "<url>" --out ./tai-ve.pdf
node {{CLI}} put ./bao-cao.xlsx --folder "<url-thư-mục>"
```

## Khi gặp lỗi

**403 / "does not have permission"** — service account là **một danh tính riêng, có email
riêng**; nó không thấy gì cho tới khi được share. Lỗi in kèm email của SA: đưa email đó cho
người dùng và bảo họ Share file/thư mục cho email ấy (Viewer để đọc, Editor để ghi). Không
thử vòng vo cách khác — không có cách nào khác.

**403 storageQuotaExceeded khi upload** — service account **không có dung lượng My Drive**.
Phải upload vào một Shared Drive; share quyền Editor cho một thư mục My Drive là không đủ.

**Link "Publish to the web"** (`/d/e/2PACX-...`) không chứa file id — bảo người dùng mở file
rồi copy link trên thanh địa chỉ.

**Chưa cấu hình credential** — bảo người dùng chạy `npx -y github:dangchison/gdrive-cli init`,
hoặc `node {{CLI}} status` để xem hỏng ở khâu nào.
