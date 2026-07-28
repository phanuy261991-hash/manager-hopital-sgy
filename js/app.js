        // Khung cơ sở dữ liệu tích hợp ERP hệ thống quản lý điều hành
        let appData = {
            _rev: 0,
            config: { adminPass: "Admin@123" },
            nhanvien: [],
            vaitro: [
                { id: "vt_1", name: "Lễ tân tòa nhà", code: "LETAN", permissions: { letan: true, kythuat: false, crmdata: false, crmkhachhang: false, taikham: false, lichphauthuat: false, quanlyvanban: false, quanlycme: false } },
                { id: "vt_2", name: "Trưởng phòng Hành chính nhân sự", code: "KETOAN", permissions: { letan: false, kythuat: false, crmdata: false, crmkhachhang: false, taikham: false, lichphauthuat: false, quanlyvanban: true, quanlycme: true } }
            ],
            phongban: [
                { id: "pb_1", code: "HCNS", name: "Phòng Hành Chính Nhân Sự", desc: "Quản trị nhân sự và điều hành văn phòng" }
            ],
            dichvu: [
                { id: "dv_1", code: "DV001", name: "Dịch vụ vệ sinh công nghiệp", desc: "Vệ sinh tổng thể văn phòng, sảnh và khu vực chung" }
            ],
            datlichhen: [],
            taikham: [],
            lichphauthuat: [],
            surgeryCodeConfig: { prefix: "PT", digits: 4, nextNumber: 1 },
            nguonkhach: [
                { id: "nk_1", code: "GT", name: "Giới thiệu", desc: "Khách hàng được giới thiệu từ khách hàng cũ hoặc người quen" }
            ],
            nhomloaivanban: [
                { id: "nlvb_1", code: "HANHCHINH", name: "Văn bản hành chính", parentId: null }
            ],
            loaivanban: [
                { id: "lvb_1", code: "LVB001", name: "Công văn", symbol: "CV", digits: 4, nextNumber: 1 }
            ],
            vanban: [],
            cme: [],
            crmdata: [],
            crmkhachhang: [],
            nhacungcap: [],
            nhaCungCapNextNumber: 1,
            nhasanxuat: [],
            nhaSanXuatNextNumber: 1,
            donvitinh: [],
            thuoc: [],
            phieunhapkho: [],
            phieuNhapKhoNextNumber: 1,
            phieuxuatkho: [],
            phieuXuatKhoNextNumber: 1,
            thuoclo: []
        };

        let fileHandle = null;
        // Nhận diện xem có đang chạy trong Electron với cầu nối (preload.js expose window.electronFileAPI) hay không.
        // Nếu KHÔNG có, app hoạt động y hệt như trước (dùng File System Access API của trình duyệt).
        const isElectronBridge = !!(window.electronFileAPI && window.electronFileAPI.isElectron);
        let electronFilePath = null; // Đường dẫn file JSON thật trên đĩa khi chạy trong Electron (song song với fileHandle khi chạy trình duyệt)
        let currentUser = null; // null tức là admin, ngược lại lưu object thông tin nhân viên đăng nhập
        let currentActivePanelId = "tab-nhan-vien";

        /* ================= CHẶN TOÀN CỤC alert()/confirm() ĐỂ TỰ ĐỘNG ÉP FOCUS SAU KHI ĐÓNG =================
           Phát hiện quan trọng: alert()/confirm() cũng là DIALOG GỐC của hệ điều hành trong Electron (giống
           hệt dialog chọn file) - đóng lại cũng gây đơ input y hệt, ví dụ báo "Sai mật khẩu" xong không xóa/
           gõ lại được ô password. MutationObserver ở dưới KHÔNG bắt được trường hợp này vì không có modal/
           màn hình nào đổi trạng thái khi chỉ có alert() hiện lên rồi tắt. Cách khắc phục triệt để nhất:
           GHI ĐÈ TOÀN CỤC window.alert/window.confirm ngay từ đầu - áp dụng tự động cho MỌI lời gọi alert()/
           confirm() có sẵn trong toàn bộ app (hàng trăm chỗ) mà không cần sửa từng nơi gọi riêng lẻ. */
        if (isElectronBridge) {
            const originalAlert = window.alert;
            window.alert = function(message) {
                const result = originalAlert(message);
                requestElectronWindowFocus();
                return result;
            };
            const originalConfirm = window.confirm;
            window.confirm = function(message) {
                const result = originalConfirm(message);
                requestElectronWindowFocus();
                return result;
            };
        }

        let currentSearchQuery = "";

        // Bộ lọc nâng cao của Đặt lịch hẹn - CHỈ lưu trong biến JS (không lưu localStorage/file),
        // nên khi tải lại trang sẽ tự động mất và danh sách quay về hiển thị mặc định (Hôm nay + 2 ngày tới)
        let advancedLichHenFilter = null;

        // Bộ lọc nâng cao của Quản lý văn bản - cùng cơ chế: chỉ lưu tạm trong biến JS, tải lại trang sẽ mất
        let advancedVanBanFilter = null;

        // Bộ lọc nâng cao của Danh sách Data - cùng cơ chế: chỉ lưu tạm trong biến JS, tải lại trang sẽ mất
        let advancedCrmDataFilter = null;
        
        // Quản lý phân trang độc lập tối đa 20 dòng trên một trang
        let currentPage = 1;
        const rowsPerPage = 20;

        /* ================= LƯU/KHÔI PHỤC FILE HANDLE QUA INDEXEDDB ================= */
        /* localStorage chỉ lưu được chuỗi (string), không lưu được FileSystemFileHandle.
           IndexedDB hỗ trợ lưu structured object nên có thể "nhớ" file thật đã chọn
           giữa các phiên làm việc, rồi xin lại quyền ghi (requestPermission) khi mở lại trang. */
        const HANDLE_DB_NAME = "sy_erp_handle_db";
        const HANDLE_STORE_NAME = "handles";
        const HANDLE_KEY = "fileHandle";

        function openHandleDB() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(HANDLE_DB_NAME, 1);
                req.onupgradeneeded = () => { req.result.createObjectStore(HANDLE_STORE_NAME); };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function saveFileHandleToDB(handle) {
            try {
                const db = await openHandleDB();
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
                    tx.objectStore(HANDLE_STORE_NAME).put(handle, HANDLE_KEY);
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
            } catch (err) { console.error("Không thể lưu tham chiếu file vào IndexedDB:", err); }
        }

        async function getFileHandleFromDB() {
            try {
                const db = await openHandleDB();
                return await new Promise((resolve, reject) => {
                    const tx = db.transaction(HANDLE_STORE_NAME, "readonly");
                    const req = tx.objectStore(HANDLE_STORE_NAME).get(HANDLE_KEY);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => reject(req.error);
                });
            } catch (err) { return null; }
        }

        async function clearFileHandleFromDB() {
            try {
                const db = await openHandleDB();
                const tx = db.transaction(HANDLE_STORE_NAME, "readwrite");
                tx.objectStore(HANDLE_STORE_NAME).delete(HANDLE_KEY);
            } catch (err) { /* bỏ qua */ }
        }

        /* ================= HÀM TIỆN ÍCH NGÀY GIỜ (DÙNG CHO ĐẶT LỊCH HẸN) ================= */
        function pad2(n) { return String(n).padStart(2, '0'); }

        /* ================= HẠ TẦNG XUẤT/NHẬP EXCEL (CSV) DÙNG CHUNG CHO TOÀN APP =================
           Dùng định dạng CSV (không phải file .xlsx nhị phân thật) vì: (1) Excel/LibreOffice/Google
           Sheets đều mở/sửa/lưu CSV bình thường như 1 bảng tính thật, (2) đọc/ghi CSV có thể tự viết
           thuần bằng JS mà KHÔNG cần thư viện ngoài -> hoạt động 100% OFFLINE trong Electron, đúng ưu
           tiên đã xuyên suốt dự án (không phụ thuộc mạng/thư viện ngoài cho tính năng cốt lõi). */

        function escapeCsvCell(val) {
            const str = String(val ?? '');
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        }

        function buildCsvContent(headers, rows) {
            const lines = [headers.map(escapeCsvCell).join(',')];
            rows.forEach(r => lines.push(r.map(escapeCsvCell).join(',')));
            return lines.join('\r\n');
        }

        function downloadCsvFile(csvContent, fileNamePrefix) {
            // Thêm BOM (\ufeff) để Excel nhận đúng encoding UTF-8, hiển thị đúng tiếng Việt có dấu
            const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const now = new Date();
            link.href = url;
            link.download = `${fileNamePrefix}_${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }

        // Trình phân tích CSV thuần JS (tự viết, không dùng thư viện) - xử lý đúng dấu phẩy/xuống dòng
        // nằm trong ô có dấu ngoặc kép, và dấu nháy kép lặp đôi ("") để biểu diễn 1 dấu " trong nội dung
        function parseCsvContent(text) {
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // Bỏ BOM nếu có
            const rows = [];
            let row = [], field = '', inQuotes = false;
            for (let i = 0; i < text.length; i++) {
                const c = text[i];
                if (inQuotes) {
                    if (c === '"') {
                        if (text[i + 1] === '"') { field += '"'; i++; }
                        else { inQuotes = false; }
                    } else field += c;
                } else {
                    if (c === '"') inQuotes = true;
                    else if (c === ',') { row.push(field); field = ''; }
                    else if (c === '\r') { /* bỏ qua, \n bên dưới mới thực sự kết thúc dòng */ }
                    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
                    else field += c;
                }
            }
            if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
            return rows.filter(r => !(r.length === 1 && r[0].trim() === '')); // bỏ dòng trống hoàn toàn
        }

        /* ================= CẤU HÌNH XUẤT/NHẬP CHO TỪNG DANH MỤC =================
           Mỗi mục cấu hình gồm: label (tên hiển thị), headers (tiêu đề cột CSV), exportRows (hàm lấy dữ
           liệu để xuất), templateExample (1 dòng ví dụ mẫu khi tải file mẫu), importRow (hàm xử lý 1 dòng
           dữ liệu đọc được khi nhập, trả về {success, error?}), afterImport (hàm chạy sau khi nhập xong
           toàn bộ, để lưu + render lại danh sách tương ứng). */
        const IMPORT_EXPORT_CONFIGS = {};

        function registerImportExportConfig(key, config) {
            IMPORT_EXPORT_CONFIGS[key] = config;
        }

        // Hàm xuất Excel (CSV) DÙNG CHUNG - chỉ cần truyền đúng key đã đăng ký cấu hình
        function exportConfigToExcel(key) {
            const cfg = IMPORT_EXPORT_CONFIGS[key];
            if (!cfg) return;
            const rows = cfg.exportRows();
            if (rows.length === 0) {
                alert(`Không có dữ liệu "${cfg.label}" nào để xuất.`);
                return;
            }
            downloadCsvFile(buildCsvContent(cfg.headers, rows), cfg.fileNamePrefix);
        }

        // Tải file mẫu (CSV) để điền dữ liệu trước khi nhập - chỉ có tiêu đề cột + 1 dòng ví dụ minh họa
        function downloadImportTemplate(key) {
            const cfg = IMPORT_EXPORT_CONFIGS[key];
            if (!cfg) return;
            downloadCsvFile(buildCsvContent(cfg.headers, [cfg.templateExample]), cfg.fileNamePrefix + '_Mau');
        }

        let currentImportConfigKey = null;
        let lastImportErrors = []; // Lưu tạm các dòng bị lỗi của lần nhập gần nhất, để nút "Tải File Các Dòng Lỗi" dùng lại

        // Mở popup nhập dữ liệu chung - dùng lại đúng 1 modal cho mọi danh mục, chỉ đổi tiêu đề + cấu hình xử lý
        function openImportModal(key) {
            const cfg = IMPORT_EXPORT_CONFIGS[key];
            if (!cfg) return;
            currentImportConfigKey = key;
            lastImportErrors = [];
            document.getElementById("title-modal-import").innerText = `Nhập Dữ Liệu "${cfg.label}" Từ Excel`;
            document.getElementById("import-file-input").value = "";
            document.getElementById("import-result-summary").innerHTML = "";
            document.getElementById("modal-import-excel").style.display = "flex";
        }

        async function processImportFile() {
            const key = currentImportConfigKey;
            const cfg = IMPORT_EXPORT_CONFIGS[key];
            const fileInput = document.getElementById("import-file-input");
            const resultBox = document.getElementById("import-result-summary");
            if (!fileInput.files || fileInput.files.length === 0) {
                return alert("Vui lòng chọn file CSV/Excel đã điền dữ liệu trước khi nhập!");
            }

            const btn = document.getElementById("btn-process-import");
            if (btn) { btn.disabled = true; btn.innerText = "Đang xử lý..."; }
            resultBox.innerHTML = "";

            try {
                const text = await fileInput.files[0].text();
                const allRows = parseCsvContent(text);
                if (allRows.length <= 1) {
                    resultBox.innerHTML = `<div style="color:#c62828;">File không có dữ liệu nào (chỉ có dòng tiêu đề hoặc trống).</div>`;
                    return;
                }
                const dataRows = allRows.slice(1); // Bỏ dòng tiêu đề

                // Với danh mục dùng Tier-2 (CME, Văn bản): đọc dữ liệu MỚI NHẤT từ file DUY NHẤT 1 LẦN
                // trước khi xử lý cả loạt dòng, thay vì đọc lại cho từng dòng riêng lẻ (chậm + dễ xung đột)
                let freshSnapshot = null;
                if (cfg.usesFreshSnapshot) {
                    freshSnapshot = await readFreshAppDataSnapshotOrWarn();
                    if (!freshSnapshot) {
                        resultBox.innerHTML = `<div style="color:#c62828;">Không thể đọc dữ liệu mới nhất từ file để nhập - vui lòng tải lại trang và thử lại.</div>`;
                        return;
                    }
                }

                let successCount = 0;
                const errors = []; // { rowNum, cells, error }
                for (let i = 0; i < dataRows.length; i++) {
                    const rowNum = i + 2; // +2 vì dòng 1 là tiêu đề, dữ liệu bắt đầu từ dòng 2 trong file gốc
                    try {
                        const result = await cfg.importRow(dataRows[i], freshSnapshot);
                        if (result && result.success) successCount++;
                        else errors.push({ rowNum, cells: dataRows[i], error: (result && result.error) || 'Lỗi không xác định' });
                    } catch (err) {
                        errors.push({ rowNum, cells: dataRows[i], error: err.message });
                    }
                }

                // Ghi lại DUY NHẤT 1 LẦN sau khi đã xử lý xong toàn bộ các dòng
                if (cfg.usesFreshSnapshot && freshSnapshot) {
                    freshSnapshot._rev = (freshSnapshot._rev || 0) + 1;
                    await persistAppDataSnapshot(freshSnapshot);
                    if (cfg.renderAfter) cfg.renderAfter();
                } else if (cfg.afterImport) {
                    await cfg.afterImport();
                }

                let html = `<div style="color:#2e7d32; font-weight:600; margin-bottom:8px;">✅ Nhập thành công ${successCount}/${dataRows.length} dòng.</div>`;
                if (errors.length > 0) {
                    html += `<div style="color:#c62828; font-weight:600; margin-bottom:6px;">⚠️ Có ${errors.length} dòng bị lỗi - xem chi tiết bên dưới để chỉnh sửa:</div>`;
                    html += `<div style="max-height:260px; overflow:auto; border:1px solid #f5c6cb; border-radius:6px; margin-bottom:8px;">`;
                    html += `<table style="width:100%; border-collapse:collapse; font-size:11.5px;">`;
                    html += `<thead><tr style="background:#fdecea; position:sticky; top:0;">`;
                    html += `<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #f5c6cb;">Dòng</th>`;
                    cfg.headers.forEach(h => html += `<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #f5c6cb; white-space:nowrap;">${escapeHtml(h)}</th>`);
                    html += `<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #f5c6cb; color:#c62828;">Lý Do Lỗi</th>`;
                    html += `</tr></thead><tbody>`;
                    errors.forEach(e => {
                        html += `<tr style="border-bottom:1px solid #f5e0e0;"><td style="padding:5px 8px; font-weight:600;">${e.rowNum}</td>`;
                        cfg.headers.forEach((h, idx) => html += `<td style="padding:5px 8px; color:#555; white-space:nowrap;">${escapeHtml(e.cells[idx] || '')}</td>`);
                        html += `<td style="padding:5px 8px; color:#c62828; font-weight:500;">${escapeHtml(e.error)}</td></tr>`;
                    });
                    html += `</tbody></table></div>`;
                    html += `<button type="button" class="secondary" style="width:auto; margin:0;" onclick="downloadImportErrorRows()">📥 Tải File Các Dòng Lỗi (để sửa & nhập lại)</button>`;
                }
                lastImportErrors = errors; // Lưu tạm để nút "Tải File Các Dòng Lỗi" phía trên dùng lại, an toàn hơn nhúng thẳng JSON vào onclick
                resultBox.innerHTML = html;
            } catch (err) {
                resultBox.innerHTML = `<div style="color:#c62828;">Không thể đọc file: ${escapeHtml(err.message)}</div>`;
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Nhập Dữ Liệu"; }
            }
        }

        // Tải về file CSV CHỈ CHỨA các dòng bị lỗi của lần nhập gần nhất, kèm thêm 1 cột "Lý Do Lỗi" ở
        // cuối để người dùng biết chính xác cần sửa gì - sửa xong có thể chọn lại chính file này để nhập lại
        function downloadImportErrorRows() {
            const cfg = IMPORT_EXPORT_CONFIGS[currentImportConfigKey];
            if (!cfg || lastImportErrors.length === 0) return;
            const headers = [...cfg.headers, 'Lý Do Lỗi (xóa cột này trước khi nhập lại)'];
            const rows = lastImportErrors.map(e => [...e.cells, e.error]);
            downloadCsvFile(buildCsvContent(headers, rows), cfg.fileNamePrefix + '_Loi');
        }



        /* ================= CONTROL NGÀY GIỜ TỰ XÂY (LUÔN 24H, KHÔNG DÙNG PICKER GỐC CỦA TRÌNH DUYỆT) =================
           Lý do: <input type="datetime-local"> hiển thị 12h (AM/PM) hay 24h phụ thuộc vào hệ điều hành/trình duyệt
           của từng máy, không thể ép buộc 100% bằng CSS/HTML. Nên mọi trường "Thời gian..." trong app đều tách thành
           1 ô ngày (input type="date", không có vấn đề AM/PM) + 2 dropdown Giờ (00-23) / Phút (00-59) tự dựng. */
        function buildHourOptions() {
            let html = '';
            for (let h = 0; h < 24; h++) html += `<option value="${pad2(h)}">${pad2(h)}</option>`;
            return html;
        }
        function buildMinuteOptions() {
            let html = '';
            for (let m = 0; m < 60; m++) html += `<option value="${pad2(m)}">${pad2(m)}</option>`;
            return html;
        }
        // Ghép 3 control (ngày + giờ + phút) thành chuỗi "YYYY-MM-DDTHH:mm" - giữ đúng định dạng cũ để
        // tương thích với toàn bộ hàm xử lý/hiển thị ngày giờ đã có sẵn trong app (formatDatetimeVN, getDateOnly...)
        function getDatetimeInputValue(prefix) {
            const dateVal = document.getElementById(`${prefix}-date`).value;
            if (!dateVal) return '';
            const hourVal = document.getElementById(`${prefix}-hour`).value || '00';
            const minuteVal = document.getElementById(`${prefix}-minute`).value || '00';
            return `${dateVal}T${hourVal}:${minuteVal}`;
        }
        // Điền ngược chuỗi "YYYY-MM-DDTHH:mm" (hoặc rỗng) vào 3 control tương ứng
        function setDatetimeInputValue(prefix, isoStr) {
            const dateEl = document.getElementById(`${prefix}-date`);
            const hourEl = document.getElementById(`${prefix}-hour`);
            const minuteEl = document.getElementById(`${prefix}-minute`);
            if (!isoStr) { dateEl.value = ''; hourEl.value = '00'; minuteEl.value = '00'; return; }
            const [datePart, timePart] = isoStr.split('T');
            dateEl.value = datePart || '';
            const [h, m] = (timePart || '00:00').split(':');
            hourEl.value = h || '00';
            minuteEl.value = m || '00';
        }

        // Định dạng Date -> chuỗi "YYYY-MM-DDTHH:mm" (đúng định dạng của input datetime-local)
        function toDatetimeLocalValue(date) {
            return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
        }

        // Lấy phần "YYYY-MM-DD" từ chuỗi datetime-local
        function getDateOnly(dtStr) { return (dtStr || "").split('T')[0]; }

        // Chuỗi "YYYY-MM-DD" của một ngày, cách hôm nay N ngày (N có thể âm/dương/0)
        function dateStringOffset(days) {
            const d = new Date();
            d.setDate(d.getDate() + days);
            return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        }

        // "YYYY-MM-DD" -> "dd/mm/yyyy"
        function formatDateVN(dateStr) {
            const parts = (dateStr || "").split('-');
            if (parts.length !== 3) return dateStr || "";
            return `${parts[2]}/${parts[1]}/${parts[0]}`;
        }

        // "YYYY-MM-DDTHH:mm" -> "dd/mm/yyyy HH:mm"
        function formatDatetimeVN(dtStr) {
            const [datePart, timePart] = (dtStr || "").split('T');
            return `${formatDateVN(datePart)}${timePart ? ' ' + timePart : ''}`;
        }

        // Tạo vài lịch hẹn mẫu để minh họa giao diện (chỉ áp dụng khi khởi tạo dữ liệu mới, chưa có file JSON nào được tải)
        (function seedSampleAppointments() {
            const now = new Date();
            const today9h = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0);
            const today15h = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 30);
            const tomorrow14h = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 14, 0);
            const dayAfterTomorrow10h = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 10, 0);
            appData.datlichhen.push(
                { id: "lh_1", customerName: "Nguyễn Văn A", phone: "0901234567", address: "12 Nguyễn Huệ, Quận 1, TP.HCM", datetime: toDatetimeLocalValue(today9h), serviceIds: ["dv_1"], sourceId: "nk_1", status: "confirmed", _v: 1 },
                { id: "lh_2", customerName: "Trần Thị B", phone: "0918888999", address: "45 Lê Lợi, Quận 1, TP.HCM", datetime: toDatetimeLocalValue(today15h), serviceIds: ["dv_1"], sourceId: "", status: "pending", _v: 1 },
                { id: "lh_3", customerName: "Lê Văn C", phone: "0933222111", address: "78 Trần Hưng Đạo, Quận 5, TP.HCM", datetime: toDatetimeLocalValue(tomorrow14h), serviceIds: ["dv_1"], sourceId: "nk_1", status: "confirmed", _v: 1 },
                { id: "lh_4", customerName: "Phạm Thị D", phone: "0977111222", address: "9 Điện Biên Phủ, Bình Thạnh, TP.HCM", datetime: toDatetimeLocalValue(dayAfterTomorrow10h), serviceIds: ["dv_1"], sourceId: "", status: "cancelled", _v: 1 }
            );

            appData.taikham.push(
                { id: "tk_1", customerName: "Hoàng Thị E", phone: "0966123456", address: "34 Nguyễn Trãi, Quận 5, TP.HCM", datetime: toDatetimeLocalValue(today15h), executionServices: ["thay_bang"], status: "confirmed", _v: 1 },
                { id: "tk_2", customerName: "Vũ Văn F", phone: "0977998877", address: "56 Lý Thường Kiệt, Quận 10, TP.HCM", datetime: toDatetimeLocalValue(tomorrow14h), executionServices: ["tai_kham", "cat_chi"], status: "pending", _v: 1 }
            );

            appData.crmdata.push(
                { id: "cd_1", phone: "0909112233", nickname: "Vy Vy Xinh Đẹp", receivedAt: toDatetimeLocalValue(today9h), sourceId: "nk_1", receiverId: "", status: "tham_khao", _v: 1 },
                { id: "cd_2", phone: "0912223344", nickname: "", receivedAt: toDatetimeLocalValue(today15h), sourceId: "", receiverId: "", status: "khong_lien_he", _v: 1 }
            );

            appData.crmkhachhang.push(
                { id: "ck_1", code: "KH001", customerName: "Đỗ Văn G", phone: "0977445566", address: "22 Cách Mạng Tháng 8, Quận 3, TP.HCM", dob: "1990-05-20", cccd: "079090001234", _v: 1 }
            );
        })();

        function ensureAppDataDefaults(target = appData) {
            if(!target.config) target.config = { adminPass: "Admin@123" };
            if(!target.nhanvien) target.nhanvien = [];
            if(!target.vaitro) target.vaitro = [];
            if(!target.phongban) target.phongban = [];
            if(!target.dichvu) target.dichvu = [];
            if(!target.datlichhen) target.datlichhen = [];
            if(!target.taikham) target.taikham = [];
            if(!target.lichphauthuat) target.lichphauthuat = [];
            if(!target.surgeryCodeConfig) target.surgeryCodeConfig = { prefix: "PT", digits: 4, nextNumber: 1 };
            if(!target.nguonkhach) target.nguonkhach = [];
            if(!target.nhomloaivanban) target.nhomloaivanban = [];
            if(!target.loaivanban) target.loaivanban = [];
            if(!target.vanban) target.vanban = [];
            if(!target.cme) target.cme = [];
            if(!target.crmdata) target.crmdata = [];
            if(!target.crmkhachhang) target.crmkhachhang = [];
            if(!target.nhacungcap) target.nhacungcap = [];
            if(typeof target.nhaCungCapNextNumber !== 'number') target.nhaCungCapNextNumber = 1;
            if(!target.nhasanxuat) target.nhasanxuat = [];
            if(typeof target.nhaSanXuatNextNumber !== 'number') target.nhaSanXuatNextNumber = 1;
            if(!target.donvitinh) target.donvitinh = [];
            if(!target.thuoc) target.thuoc = [];
            if(!target.phieunhapkho) target.phieunhapkho = [];
            if(typeof target.phieuNhapKhoNextNumber !== 'number') target.phieuNhapKhoNextNumber = 1;
            if(!target.phieuxuatkho) target.phieuxuatkho = [];
            if(typeof target.phieuXuatKhoNextNumber !== 'number') target.phieuXuatKhoNextNumber = 1;
            if(!target.thuoclo) target.thuoclo = [];
            if(!target.activityLogs) target.activityLogs = [];
            if(typeof target._rev !== 'number') target._rev = 0;
        }

        /* ================= NHẬT KÝ HOẠT ĐỘNG (GHI LOG THAO TÁC NGƯỜI DÙNG + LỖI HỆ THỐNG) =================
           Ghi lại TRỰC TIẾP vào appData.activityLogs (đi kèm với file JSON chung, không cần lưu trữ riêng)
           - loại 'action': theo dõi thao tác người dùng (Thêm/Sửa/Xóa/Đăng nhập...)
           - loại 'error': theo dõi lỗi đọc/ghi file JSON ("database" của app) và lỗi JS phát sinh bất kỳ
           Giới hạn tối đa 2000 dòng gần nhất để tránh làm phình to file JSON theo thời gian - log cũ hơn
           sẽ tự động bị loại bỏ dần (log là để theo dõi GẦN ĐÂY, không phải lưu trữ vĩnh viễn). */
        const ACTIVITY_LOG_MAX_ENTRIES = 2000;

        // targetData: mặc định ghi vào appData (đủ cho các module Tier-1 thao tác trực tiếp trên appData).
        // Với module Tier-2 (đọc-mới-nhất-rồi-ghi), PHẢI truyền vào đúng biến "fresh" đang được thao tác -
        // vì persistAppDataSnapshot(fresh) sẽ THAY THẾ HẲN appData bằng fresh, nên nếu log bị ghi nhầm vào
        // appData (đối tượng CŨ) thay vì fresh, log đó sẽ bị ghi đè mất ngay khi lưu, không bao giờ tới
        // được file - đây chính là lỗi đã phát hiện: log Thêm/Sửa/Xóa ở các module Tier-2 bị mất.
        function logActivity(type, moduleName, action, details, targetData) {
            try {
                const target = targetData || appData;
                if (!target.activityLogs) target.activityLogs = [];
                const identity = (typeof getCurrentSessionIdentity === 'function') ? getCurrentSessionIdentity() : { name: 'Hệ thống' };
                target.activityLogs.push({
                    id: generateUniqueId("log"),
                    datetime: new Date().toISOString(),
                    type, // 'action' | 'error'
                    user: identity.name,
                    module: moduleName,
                    action,
                    details: details || ''
                });
                if (target.activityLogs.length > ACTIVITY_LOG_MAX_ENTRIES) {
                    target.activityLogs = target.activityLogs.slice(-ACTIVITY_LOG_MAX_ENTRIES);
                }
                // Log KHÔNG tự ý gọi lưu file riêng - sẽ được ghi kèm theo lần lưu tiếp theo của chính
                // thao tác đang xảy ra (đỡ phải ghi file thêm 1 lần riêng cho mỗi log, tránh làm chậm ứng
                // dụng). Với lỗi xảy ra khi KHÔNG có thao tác lưu nào đi kèm (ví dụ lỗi JS ngẫu nhiên), log
                // đó vẫn tồn tại trong bộ nhớ và sẽ được ghi vào file ở lần lưu thành công gần nhất tiếp theo.
            } catch (err) {
                console.error("Không thể ghi log hoạt động:", err);
            }
        }

        // Bắt TOÀN BỘ lỗi JavaScript không được xử lý (uncaught exception) xảy ra ở bất kỳ đâu trong app
        window.addEventListener('error', (event) => {
            logActivity('error', 'Hệ thống', 'Lỗi JavaScript không xác định', `${event.message} (dòng ${event.lineno})`);
        });
        // Bắt lỗi từ các Promise bị reject mà không có .catch() xử lý (ví dụ 1 hàm async quên try/catch)
        window.addEventListener('unhandledrejection', (event) => {
            logActivity('error', 'Hệ thống', 'Lỗi Promise không được xử lý', String(event.reason && event.reason.message || event.reason));
        });

        // Sinh ID kèm hậu tố ngẫu nhiên -> tránh trùng ID khi 2 người bấm "Lưu" cùng một mili-giây
        function generateUniqueId(prefix) {
            return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }

        // Chỉ tài khoản Admin (Tối cao) mới được phép xóa dữ liệu ở BẤT KỲ chức năng nào trên toàn app.
        // currentUser === null nghĩa là đang đăng nhập bằng tài khoản admin (xem handleLogin).
        function isAdminUser() {
            return currentUser === null;
        }

        /* Kiểm tra "Mã khách hàng mồ côi": mã này đã từng gắn với lịch sử phẫu thuật/lịch hẹn TRƯỚC ĐÂY,
           nhưng hiện KHÔNG có khách hàng nào trong Danh sách khách hàng đang thực sự sở hữu mã đó (do khách
           hàng cũ đã bị XÓA). Nếu vẫn cho phép dùng lại mã này cho khách hàng MỚI hoàn toàn khác, hệ thống sẽ
           tự động "nhận vơ" lịch sử của người cũ (vì đối chiếu dữ liệu dựa theo Mã khách hàng) - đây chính là
           lỗi người dùng đã báo cáo. Hàm này giúp cảnh báo TRƯỚC khi lỗi đó xảy ra. */
        function hasOrphanedHistoryForCode(code) {
            if (!code) return false;
            const hasCurrentOwner = appData.crmkhachhang.some(c => c.code === code);
            if (hasCurrentOwner) return false; // Mã này vẫn đang có chủ hợp lệ -> không phải trường hợp mồ côi
            const hasSurgeryHistory = appData.lichphauthuat.some(x => x.code === code);
            return hasSurgeryHistory;
        }

        function confirmOrphanedCodeReuse(code) {
            return confirm(
                `⚠️ Mã khách hàng "${code}" đã từng gắn với lịch sử phẫu thuật của MỘT KHÁCH HÀNG KHÁC đã bị xóa khỏi Danh sách khách hàng trước đó.\n\n` +
                `Nếu tiếp tục dùng mã này, lịch sử phẫu thuật CŨ đó sẽ tự động hiển thị NHẦM thành lịch sử của khách hàng MỚI này (vì hệ thống nhận diện theo Mã khách hàng).\n\n` +
                `Bấm OK để VẪN TIẾP TỤC dùng mã này (không khuyến khích), hoặc Cancel để hủy và đổi sang mã khác an toàn hơn.`
            );
        }

        /* Điều khiển dropdown "Hành động" gom nhiều nút thao tác trên 1 dòng bảng (dùng cho Danh sách Data).
           Dùng position:fixed tính theo tọa độ thực của nút để tránh bị .table-responsive (overflow-x: auto)
           cắt xén dropdown ở các dòng cuối bảng. */
        function toggleActionDropdown(btn) {
            const menu = btn.nextElementSibling;
            const isOpen = menu.classList.contains('open');
            closeAllActionDropdowns();
            if (!isOpen) {
                const rect = btn.getBoundingClientRect();
                menu.style.position = 'fixed';
                menu.style.top = (rect.bottom + 4) + 'px';
                menu.style.left = 'auto';
                menu.style.right = (window.innerWidth - rect.right) + 'px';
                menu.classList.add('open');
            }
        }
        function closeAllActionDropdowns() {
            document.querySelectorAll('.action-dropdown-menu.open').forEach(m => {
                m.classList.remove('open');
                m.style.position = ''; m.style.top = ''; m.style.left = ''; m.style.right = '';
            });
        }
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.action-dropdown')) closeAllActionDropdowns();
        });
        window.addEventListener('scroll', closeAllActionDropdowns, true);

        /* Cập nhật badge trạng thái đồng bộ + nút "Kết Nối Lưu File" trên header */
        function setSyncBadge(isSynced) {
            const badge = document.getElementById("sync-status");
            const linkBtn = document.getElementById("btn-link-file");
            if (isSynced) {
                badge.style.backgroundColor = "#e8f5e9"; badge.style.color = "var(--success)"; badge.style.borderColor = "var(--success)";
                badge.innerText = "Tự Động Lưu File";
                if (linkBtn) linkBtn.style.display = "none";
                updateCurrentFileNameDisplay();
            } else {
                badge.style.backgroundColor = "#fff3e0"; badge.style.color = "#ef6c00"; badge.style.borderColor = "#ef6c00";
                badge.innerText = "Lưu Tạm Thời";
                if (linkBtn) linkBtn.style.display = "inline-block";
            }
        }

        // Lấy tên file JSON đang kết nối (chỉ lấy tên file, bỏ đường dẫn thư mục để hiển thị gọn trên header)
        function getCurrentFileName() {
            if (isElectronBridge && electronFilePath) {
                const parts = electronFilePath.split(/[/\\]/);
                return parts[parts.length - 1];
            }
            if (fileHandle && fileHandle.name) return fileHandle.name;
            return null;
        }

        // Cập nhật dòng hiển thị tên file đang kết nối trên header - gọi ngay sau mỗi lần kết nối file
        // thành công (đặt trong setSyncBadge(true) vì đó là điểm chung mọi luồng kết nối đều đi qua)
        function updateCurrentFileNameDisplay() {
            const el = document.getElementById("current-file-name-display");
            if (!el) return;
            const name = getCurrentFileName();
            el.innerText = name ? `📄 ${name}` : "";
            el.title = isElectronBridge ? (electronFilePath || '') : (name || '');
        }

        // Cho phép người dùng CHỦ ĐỘNG tải lại dữ liệu mới nhất từ file JSON bất cứ lúc nào có nhu cầu,
        // chạy SONG SONG với cơ chế tự động đọc-mới-nhất-trước-khi-ghi vốn đã có sẵn mỗi khi thao tác lưu -
        // hữu ích khi muốn xem ngay các thay đổi từ máy khác mà không cần đợi tới lúc thực hiện thao tác gì.
        async function reloadLatestDataFromFile() {
            const btn = document.getElementById("btn-reload-data");
            if (btn) { btn.disabled = true; btn.innerText = "Đang tải..."; }
            try {
                const fresh = await readFreshAppDataSnapshot();
                if (!fresh) {
                    alert("❌ Không thể đọc file dữ liệu hiện tại — file có thể đã bị xóa, di chuyển, hoặc mất kết nối.\n\nVui lòng tải lại trang và kết nối lại file JSON.");
                    return;
                }
                appData = fresh;
                renderCurrentPanelData();
                const badge = document.getElementById("sync-status");
                const originalText = badge.innerText;
                badge.innerText = "✓ Đã tải mới nhất";
                setTimeout(() => { badge.innerText = originalText; }, 2000);
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "🔄 Tải Dữ Liệu Mới Nhất"; }
            }
        }

        window.onload = async function() {
            if (isElectronBridge) {
                // Trong Electron: đường dẫn file cuối cùng đã dùng được lưu bởi main.js (KHÔNG dùng IndexedDB/LocalStorage)
                const lastPath = await window.electronFileAPI.getLastFilePath();
                if (!lastPath) return;
                document.getElementById("reconnect-section").style.display = "block";
                document.getElementById("reconnect-buttons").innerHTML = `<button onclick="reconnectWithHandle()">🔓 Kết Nối Lại File & Tiếp Tục</button>`;
                document.getElementById("reconnect-note").innerText = "*(Hệ thống sẽ kiểm tra file JSON đã liên kết trước đó có còn tồn tại và đọc được hay không)*";
                return;
            }

            // CHỈ hiện màn hình "phát hiện phiên trước" nếu có tham chiếu file (IndexedDB) đã từng kết nối.
            // Đã bỏ hẳn việc dựa vào LocalStorage để phát hiện phiên cũ, vì LocalStorage không xác nhận được
            // file thật trên đĩa có còn tồn tại hay không - đây chính là nguyên nhân gây lỗi trước đây.
            const savedHandle = await getFileHandleFromDB();
            if (!savedHandle) return; // Không có gì để kết nối lại -> vào thẳng màn hình chọn/tạo file như bình thường

            document.getElementById("reconnect-section").style.display = "block";
            const btnContainer = document.getElementById("reconnect-buttons");
            const note = document.getElementById("reconnect-note");
            btnContainer.innerHTML = `<button onclick="reconnectWithHandle()">🔓 Kết Nối Lại File & Tiếp Tục</button>`;
            note.innerText = "*(Hệ thống sẽ kiểm tra file JSON đã liên kết trước đó có còn tồn tại và đọc được hay không)*";
        };

        /* Xin lại quyền ghi + XÁC MINH THẬT SỰ file vẫn còn tồn tại và đọc được trước khi cho vào app.
           Nếu file đã bị xóa/di chuyển/mất quyền -> BÁO LỖI RÕ RÀNG và KHÔNG cho vào (thay vì âm thầm
           rơi về "chế độ tạm" dùng dữ liệu cũ trong LocalStorage như trước đây, gây ra tình trạng dữ liệu
           đã xóa ở máy khác vẫn "sống lại" khi máy này lỡ ghi đè file bằng dữ liệu cũ đang cache sẵn). */
        async function reconnectWithHandle() {
            if (isElectronBridge) {
                try {
                    const lastPath = await window.electronFileAPI.getLastFilePath();
                    if (!lastPath) {
                        alert("Không tìm thấy đường dẫn file đã lưu trước đó. Vui lòng chọn lại file JSON để tiếp tục.");
                        document.getElementById("reconnect-section").style.display = "none";
                        return;
                    }
                    // Thử đọc THẬT SỰ nội dung file (qua main process Electron) để xác nhận file vẫn tồn tại và hợp lệ
                    const result = await window.electronFileAPI.readFile(lastPath);
                    if (!result.success) throw new Error(result.error || "Không đọc được file");
                    const parsed = JSON.parse(result.content);

                    electronFilePath = lastPath;
                    appData = parsed;
                    ensureAppDataDefaults();
                    goToLogin();
                    setSyncBadge(true);
                } catch (err) {
                    console.error("Không thể kết nối lại file đã lưu (Electron):", err);
                    alert("❌ Không thể mở file dữ liệu đã liên kết trước đó — file có thể đã bị XÓA, DI CHUYỂN, hoặc đổi tên.\n\nVui lòng chọn lại đúng file JSON, hoặc tạo file dữ liệu mới ở màn hình tiếp theo.");
                    await window.electronFileAPI.clearLastFilePath();
                    document.getElementById("reconnect-section").style.display = "none";
                }
                return;
            }

            try {
                const handle = await getFileHandleFromDB();
                if (!handle) {
                    alert("Không tìm thấy tham chiếu file đã lưu trước đó. Vui lòng chọn lại file JSON để tiếp tục.");
                    document.getElementById("reconnect-section").style.display = "none";
                    return;
                }

                const permission = await handle.requestPermission({ mode: 'readwrite' });
                if (permission !== 'granted') {
                    alert("Bạn chưa cấp quyền truy cập file. Vui lòng chọn lại file JSON để tiếp tục.");
                    await clearFileHandleFromDB();
                    document.getElementById("reconnect-section").style.display = "none";
                    return;
                }

                // Thử đọc THẬT SỰ nội dung file để xác nhận file vẫn còn tồn tại và hợp lệ - nếu file đã bị
                // xóa/di chuyển, bước này sẽ ném lỗi và rơi vào catch bên dưới.
                const file = await handle.getFile();
                const text = await file.text();
                const parsed = JSON.parse(text);

                fileHandle = handle;
                appData = parsed;
                ensureAppDataDefaults();
                goToLogin();
                setSyncBadge(true);
            } catch (err) {
                console.error("Không thể kết nối lại file đã lưu:", err);
                alert("❌ Không thể mở file dữ liệu đã liên kết trước đó — file có thể đã bị XÓA, DI CHUYỂN, hoặc đổi tên.\n\nVui lòng chọn lại đúng file JSON, hoặc tạo file dữ liệu mới ở màn hình tiếp theo.");
                await clearFileHandleFromDB();
                document.getElementById("reconnect-section").style.display = "none";
            }
        }

        /* Cho phép liên kết lại (hoặc liên kết lần đầu) một file JSON thật ngay trong lúc đang dùng app,
           không cần thoát ra màn hình đăng nhập. Dữ liệu hiện tại sẽ được ghi ngay vào file vừa chọn. */
        async function linkExistingFileToSession() {
            if (isElectronBridge) {
                try {
                    const picked = await window.electronFileAPI.pickSaveFile();
                    if (picked.canceled || !picked.filePath) { alert("Đã hủy thao tác kết nối file."); return; }
                    electronFilePath = picked.filePath;
                    await window.electronFileAPI.setLastFilePath(electronFilePath);
                    await writeDataToFileHandle();
                    setSyncBadge(true);
                    alert("Đã liên kết file lưu trữ thành công! Toàn bộ dữ liệu hiện tại đã được ghi vào file, các thay đổi tiếp theo sẽ tự động đồng bộ.");
                } catch (err) { alert("Đã hủy thao tác kết nối file."); }
                return;
            }
            if (!window.showSaveFilePicker) { alert("Trình duyệt không hỗ trợ API ghi dữ liệu cứng."); return; }
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'erp_operating_data.json',
                    types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
                });
                fileHandle = handle;
                await saveFileHandleToDB(fileHandle);
                await writeDataToFileHandle();
                setSyncBadge(true);
                alert("Đã liên kết file lưu trữ thành công! Toàn bộ dữ liệu hiện tại đã được ghi vào file, các thay đổi tiếp theo sẽ tự động đồng bộ.");
            } catch (err) {
                alert("Đã hủy thao tác kết nối file.");
            }
        }

        async function createNewJsonFileViaAPI() {
            if (isElectronBridge) {
                try {
                    const picked = await window.electronFileAPI.pickSaveFile();
                    if (picked.canceled || !picked.filePath) { alert("Hủy thiết lập lưu file mới."); return; }
                    electronFilePath = picked.filePath;
                    await window.electronFileAPI.setLastFilePath(electronFilePath);
                    await writeDataToFileHandle();
                    alert("Đã khởi tạo file dữ liệu điều hành ERP mới thành công!");
                    goToLogin();
                    setSyncBadge(true);
                } catch (err) { alert("Hủy thiết lập lưu file mới."); }
                return;
            }
            try {
                fileHandle = await window.showSaveFilePicker({
                    suggestedName: 'erp_operating_data.json',
                    types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
                });
                await saveFileHandleToDB(fileHandle);
                await writeDataToFileHandle();
                alert("Đã khởi tạo file dữ liệu điều hành ERP mới thành công!");
                goToLogin();
                setSyncBadge(true);
            } catch (err) { alert("Hủy thiết lập lưu file mới."); }
        }

        function handleCreateNewJsonWithAPI() {
            if (isElectronBridge) { createNewJsonFileViaAPI(); }
            else if (window.showSaveFilePicker) { createNewJsonFileViaAPI(); } 
            else { alert("Trình duyệt không hỗ trợ API ghi dữ liệu cứng."); goToLogin(); }
        }

        async function loadJsonFileViaAPI() {
            if (isElectronBridge) {
                try {
                    const picked = await window.electronFileAPI.pickOpenFile();
                    if (picked.canceled || !picked.filePath) { alert("Hủy chọn file dữ liệu."); return; }
                    const result = await window.electronFileAPI.readFile(picked.filePath);
                    if (!result.success) throw new Error(result.error || "Không đọc được file");
                    electronFilePath = picked.filePath;
                    appData = JSON.parse(result.content);
                    ensureAppDataDefaults();
                    await window.electronFileAPI.setLastFilePath(electronFilePath);
                    alert("Đồng bộ hệ thống dữ liệu điều hành thành công!");
                    goToLogin();
                    setSyncBadge(true);
                } catch (err) { alert("Hủy chọn file dữ liệu."); }
                return;
            }
            try {
                [fileHandle] = await window.showOpenFilePicker({
                    types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
                    multiple: false
                });
                const file = await fileHandle.getFile();
                const content = await file.text();
                appData = JSON.parse(content);
                ensureAppDataDefaults();
                await saveFileHandleToDB(fileHandle);
                alert("Đồng bộ hệ thống dữ liệu điều hành thành công!");
                goToLogin();
                setSyncBadge(true);
            } catch (err) { alert("Hủy chọn file dữ liệu."); }
        }

        function handleLoadJsonWithAPI() {
            if (isElectronBridge) { loadJsonFileViaAPI(); }
            else if (window.showOpenFilePicker) { loadJsonFileViaAPI(); } 
            else { alert("Trình duyệt không hỗ trợ API chọn file."); }
        }

        async function writeDataToFileHandle() {
            if (isElectronBridge) {
                if (!electronFilePath) return;
                try {
                    const result = await window.electronFileAPI.writeFile(electronFilePath, JSON.stringify(appData, null, 4));
                    if (!result.success) throw new Error(result.error || "Ghi file thất bại");
                } catch (err) {
                    const badge = document.getElementById("sync-status");
                    badge.style.backgroundColor = "#ffebee"; badge.style.color = "#c62828"; badge.style.borderColor = "#c62828";
                    badge.innerText = "Lỗi Lưu Cứng! (Kiểm tra lại quyền/file)";
                    const linkBtn = document.getElementById("btn-link-file");
                    if (linkBtn) linkBtn.style.display = "inline-block";
                }
                return;
            }
            if (!fileHandle) return;
            try {
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(appData, null, 4));
                await writable.close();
            } catch (err) {
                // Quyền ghi có thể đã bị thu hồi hoặc file đã bị xóa/di chuyển bên ngoài trình duyệt
                const badge = document.getElementById("sync-status");
                badge.style.backgroundColor = "#ffebee"; badge.style.color = "#c62828"; badge.style.borderColor = "#c62828";
                badge.innerText = "Lỗi Lưu Cứng! (Kiểm tra lại quyền/file)";
                const linkBtn = document.getElementById("btn-link-file");
                if (linkBtn) linkBtn.style.display = "inline-block";
            }
        }

        /* Tên hàm giữ nguyên "saveToLocalStorage" để không phải sửa lại hàng chục nơi gọi hàm này trong app,
           nhưng bản chất đã KHÔNG CÒN dùng LocalStorage nữa - giờ đọc và ghi THẲNG vào file JSON thật.
           Trước khi ghi, luôn đọc lại file để kiểm tra xem có ai (máy khác) vừa lưu thay đổi mới hơn hay
           chưa (so sánh số phiên bản _rev) - nếu có, DỪNG LẠI và yêu cầu tải lại trang thay vì âm thầm ghi
           đè dữ liệu cũ đang có trong bộ nhớ lên trên, tránh làm "hồi sinh" nhầm dữ liệu đã bị xóa/sửa ở
           máy khác (đây chính là lỗi đã được báo cáo và khắc phục). */
        async function saveToLocalStorage() {
            if (isElectronBridge) {
                if (!electronFilePath) {
                    logActivity('error', 'Kết nối file dữ liệu', 'Chưa kết nối file JSON', 'Electron - thao tác ghi bị từ chối vì chưa có file được kết nối.');
                    alert("⚠️ Ứng dụng chưa kết nối với file dữ liệu JSON thật trên máy. Vui lòng chọn/tạo file JSON để có thể thao tác an toàn.");
                    return;
                }
                try {
                    const result = await window.electronFileAPI.readFile(electronFilePath);
                    if (!result.success) throw new Error(result.error || "Không đọc được file");
                    const onDisk = JSON.parse(result.content);
                    if (typeof onDisk._rev === 'number' && typeof appData._rev === 'number' && onDisk._rev > appData._rev) {
                        logActivity('error', 'Kết nối file dữ liệu', 'Xung đột dữ liệu', `Electron - file đã được cập nhật mới hơn (rev ${onDisk._rev} > ${appData._rev}) trong lúc đang thao tác, đã tự tải lại trang.`);
                        alert("⚠️ Dữ liệu trên file đã được người khác/máy khác cập nhật mới hơn trong lúc bạn đang thao tác.\n\nTrang sẽ tự động tải lại để lấy đúng dữ liệu mới nhất - vui lòng thực hiện lại thao tác vừa rồi.");
                        location.reload();
                        return;
                    }
                } catch (err) {
                    console.error("Không thể đọc file dữ liệu hiện tại trước khi ghi (Electron):", err);
                    logActivity('error', 'Kết nối file dữ liệu', 'Không đọc được file JSON trước khi ghi', `Electron - ${err.message}`);
                    alert("❌ Không thể đọc file dữ liệu hiện tại — file có thể đã bị xóa hoặc di chuyển. Vui lòng tải lại trang và kết nối lại đúng file JSON để tránh mất dữ liệu.");
                    return;
                }
                appData._rev = (appData._rev || 0) + 1;
                await writeDataToFileHandle();
                return;
            }
            if (!fileHandle) {
                logActivity('error', 'Kết nối file dữ liệu', 'Chưa kết nối file JSON', 'Trình duyệt - thao tác ghi bị từ chối vì chưa có file được kết nối.');
                alert("⚠️ Ứng dụng chưa kết nối với file dữ liệu JSON thật trên máy. Vui lòng tải lại trang (F5) và chọn/tạo file JSON để có thể thao tác an toàn.");
                return;
            }
            try {
                const file = await fileHandle.getFile();
                const text = await file.text();
                const onDisk = JSON.parse(text);
                if (typeof onDisk._rev === 'number' && typeof appData._rev === 'number' && onDisk._rev > appData._rev) {
                    logActivity('error', 'Kết nối file dữ liệu', 'Xung đột dữ liệu', `Trình duyệt - file đã được cập nhật mới hơn (rev ${onDisk._rev} > ${appData._rev}) trong lúc đang thao tác, đã tự tải lại trang.`);
                    alert("⚠️ Dữ liệu trên file đã được người khác/máy khác cập nhật mới hơn trong lúc bạn đang thao tác.\n\nTrang sẽ tự động tải lại để lấy đúng dữ liệu mới nhất - vui lòng thực hiện lại thao tác vừa rồi.");
                    location.reload();
                    return;
                }
            } catch (err) {
                console.error("Không thể đọc file dữ liệu hiện tại trước khi ghi:", err);
                logActivity('error', 'Kết nối file dữ liệu', 'Không đọc được file JSON trước khi ghi', `Trình duyệt - ${err.message}`);
                alert("❌ Không thể đọc file dữ liệu hiện tại — file có thể đã bị xóa hoặc di chuyển. Vui lòng tải lại trang và kết nối lại đúng file JSON để tránh mất dữ liệu.");
                return;
            }
            appData._rev = (appData._rev || 0) + 1;
            await writeDataToFileHandle();
        }

        function goToLogin() {
            prefillRememberedLogin();
            switchScreen("json-screen", "login-screen");
            forceFocusLoginInput();
        }

        /* ================= GHI NHỚ ĐĂNG NHẬP =================
           Chỉ lưu MỘT thông tin đăng nhập RIÊNG của từng máy (localStorage) - KHÔNG liên quan gì tới dữ
           liệu chung của app (appData) nên không vi phạm nguyên tắc "chỉ đọc/ghi qua file JSON" đã áp dụng
           cho dữ liệu nghiệp vụ; đây thuần túy là 1 tùy chọn giao diện của riêng máy đang dùng, không đồng
           bộ giữa các máy - đúng bản chất của tính năng "ghi nhớ đăng nhập". Lưu ý: mật khẩu được lưu ở
           dạng thô (giống cách appData đang lưu mật khẩu nhân viên) - chỉ nên dùng trên máy cá nhân đáng
           tin cậy. */
        function handleRememberLoginPreference(username, password) {
            try {
                if (document.getElementById("remember-login").checked) {
                    localStorage.setItem("sy_erp_remembered_login", JSON.stringify({ username, password }));
                } else {
                    localStorage.removeItem("sy_erp_remembered_login");
                }
            } catch (err) {
                console.error("Không thể lưu/xóa thông tin đăng nhập đã ghi nhớ:", err);
            }
        }

        // Tự động điền lại tên đăng nhập + mật khẩu đã ghi nhớ trước đó (nếu có) ngay khi màn hình đăng
        // nhập hiện ra - không tự động đăng nhập thay người dùng, chỉ điền sẵn cho đỡ phải gõ tay lại.
        function prefillRememberedLogin() {
            try {
                const saved = localStorage.getItem("sy_erp_remembered_login");
                if (!saved) return;
                const { username, password } = JSON.parse(saved);
                document.getElementById("username").value = username || "";
                document.getElementById("password").value = password || "";
                document.getElementById("remember-login").checked = true;
            } catch (err) {
                console.error("Không thể đọc thông tin đăng nhập đã ghi nhớ (dữ liệu có thể bị hỏng):", err);
            }
        }

        // Yêu cầu chính (renderer) chủ động ép focus cửa sổ - dùng ở mọi nơi cần thiết trong Electron
        function requestElectronWindowFocus() {
            if (isElectronBridge && window.electronFileAPI.focusWindow) {
                window.electronFileAPI.focusWindow();
            }
        }

        // Đảm bảo focus THẬT SỰ vào ô đăng nhập ngay khi màn hình đăng nhập vừa hiện ra. Quan trọng nhất
        // trong Electron: sau khi dialog chọn file (dialog gốc hệ điều hành) đóng lại, cửa sổ đôi khi không
        // được trả lại đúng focus bàn phím dù giao diện trông vẫn bình thường, khiến ô nhập bị "đơ". Renderer
        // chủ động gọi ép focus NGAY TẠI THỜI ĐIỂM CHÍNH XÁC này (thay vì để main process tự đoán thời điểm).
        function forceFocusLoginInput() {
            requestElectronWindowFocus();
            // Đợi 1 nhịp để trình duyệt/Electron vẽ xong giao diện trước khi ép focus vào ô input cụ thể
            setTimeout(() => {
                const usernameInput = document.getElementById("username");
                if (usernameInput) usernameInput.focus();
            }, 150);
        }

        /* ================= GIÁM SÁT CHUYỂN MÀN HÌNH ĐỂ ÉP FOCUS TRONG ELECTRON =================
           LƯU Ý QUAN TRỌNG: trước đây có áp dụng thêm việc giám sát MỌI modal thông thường trong app
           (mỗi khi 1 modal chuyển sang hiển thị là ép focus lại cửa sổ bằng kỹ thuật ẩn/hiện) - nhưng
           đây là SAI LẦM: modal thông thường chỉ là bật/tắt CSS (display:flex) thuần túy trong cùng
           1 trang web, KHÔNG hề có dialog gốc nào của hệ điều hành xen vào nên KHÔNG hề có lý do gì
           để mất focus cả. Áp dụng kỹ thuật ẩn/hiện cửa sổ (vốn chỉ cần thiết sau dialog GỐC thật sự)
           cho MỌI modal khiến cửa sổ bị nháy liên tục mỗi khi mở bất kỳ form nhập liệu nào - gây khó
           chịu nghiêm trọng cho người dùng. Đã BỎ hẳn phần giám sát modal, CHỈ giữ lại giám sát chuyển
           MÀN HÌNH LỚN (json-screen/login-screen/main-screen) - việc này hiếm khi xảy ra (chỉ vài lần
           mỗi phiên làm việc) nên không gây nháy khó chịu, trong khi vẫn xử lý đúng trường hợp đã xác
           nhận cần thiết: vào màn hình đăng nhập ngay sau khi vừa đóng dialog chọn file. */
        if (isElectronBridge) {
            document.querySelectorAll('.screen').forEach(screenEl => {
                new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.attributeName === 'class' && screenEl.classList.contains('active')) {
                            requestElectronWindowFocus();
                            break;
                        }
                    }
                }).observe(screenEl, { attributes: true, attributeFilter: ['class'] });
            });
            // (Việc bọc alert()/confirm() để tự ép focus đã được thực hiện DUY NHẤT 1 lần ở đầu file,
            // ngay sau khi khai báo isElectronBridge - xem khối "CHẶN TOÀN CỤC alert()/confirm()" phía trên)
        }

        function backToJsonScreen() { switchScreen("login-screen", "json-screen"); }
        function switchScreen(fromId, toId) {
            document.getElementById(fromId).classList.remove("active");
            document.getElementById(toId).classList.add("active");
        }

        /* HÀM XỬ LÝ ĐĂNG NHẬP PHÂN QUYỀN ĐỘNG (ADMIN & NHÂN VIÊN) */
        function handleLogin() {
            const u = document.getElementById("username").value.trim();
            const p = document.getElementById("password").value;
            const adminSavedPass = appData.config.adminPass || "Admin@123";

            if (u === "admin" && p === adminSavedPass) {
                // Đăng nhập quyền tối cao Admin
                currentUser = null;
                handleRememberLoginPreference(u, p);
                logActivity('action', 'Đăng nhập', 'Đăng nhập thành công', 'Tài khoản Tối Cao (Admin)');
                saveToLocalStorage();
                document.getElementById("current-user-info").innerText = "Tài khoản đăng nhập: Tối Cao (Admin)";
                updateSidebarUserAvatar("Tối Cao Admin");
                document.getElementById("menu-group-admin").style.display = "block";
                document.getElementById("btn-admin-pwd").style.display = "inline-block";
                
                // Mở hết tất cả các phân hệ chức năng cho Admin
                document.getElementById("menu-item-le-tan").style.display = "flex";
                document.getElementById("menu-item-dashboard-letan").style.display = "flex";
                document.getElementById("menu-item-crm-data").style.display = "flex";
                document.getElementById("menu-item-dat-lich-hen").style.display = "flex";
                document.getElementById("menu-item-tai-kham").style.display = "flex";
                document.getElementById("menu-item-lich-phau-thuat").style.display = "flex";
                document.getElementById("menu-item-crm").style.display = "flex";
                document.getElementById("menu-item-crm-khach-hang").style.display = "flex";
                document.getElementById("menu-item-ke-toan").style.display = "flex";
                document.getElementById("menu-item-quan-ly-van-ban").style.display = "flex";
                document.getElementById("menu-item-quan-ly-cme").style.display = "flex";
                document.getElementById("menu-item-khoa-duoc").style.display = "flex";
                document.getElementById("menu-item-nha-cung-cap").style.display = "flex";
                document.getElementById("menu-item-nha-san-xuat").style.display = "flex";
                document.getElementById("menu-item-don-vi-tinh").style.display = "flex";
                document.getElementById("menu-item-nhap-lieu-kho-thuoc").style.display = "flex";
                document.getElementById("menu-item-phieu-kho").style.display = "flex";
                document.getElementById("menu-item-ky-thuat").style.display = "flex";

                setupMainWorkspace("tab-nhan-vien");
            } else {
                // Kiểm tra đăng nhập dưới tài khoản của Nhân Viên trong CSDL
                const nv = appData.nhanvien.find(x => x.username === u && x.password === p);
                if (nv) {
                    if (nv.locked) {
                        alert("🔒 Tài khoản này đã bị KHÓA (nhân viên đã nghỉ việc). Vui lòng liên hệ Quản trị viên nếu cần hỗ trợ.");
                        return;
                    }
                    currentUser = nv;
                    handleRememberLoginPreference(u, p);
                    logActivity('action', 'Đăng nhập', 'Đăng nhập thành công', `Nhân viên: ${nv.name} (${nv.code})`);
                    saveToLocalStorage();
                    const vtObj = appData.vaitro.find(v => v.id === nv.vaiTroId);
                    document.getElementById("current-user-info").innerText = `Nhân viên: ${nv.name} (${vtObj ? vtObj.name : 'Chưa phân chức vụ'})`;
                    updateSidebarUserAvatar(nv.name);
                    
                    // Ẩn nhóm Quản trị Hệ Thống đối với nhân viên thường
                    document.getElementById("menu-group-admin").style.display = "none";
                    document.getElementById("btn-admin-pwd").style.display = "none";

                    // Áp dụng Ma trận phân quyền động dựa vào Vai trò được chỉ định
                    let firstPanelAllowed = "";
                    if (vtObj && vtObj.permissions) {
                        // Lễ tân: phân quyền RIÊNG BIỆT cho từng sub-menu con (Dashboard / Data / Đặt lịch hẹn)
                        let letanAnyAllowed = false;
                        if (vtObj.permissions.dashboardletan) {
                            document.getElementById("menu-item-dashboard-letan").style.display = "flex";
                            letanAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-dashboard-letan";
                        } else {
                            document.getElementById("menu-item-dashboard-letan").style.display = "none";
                        }
                        if (vtObj.permissions.crmdata) {
                            document.getElementById("menu-item-crm-data").style.display = "flex";
                            letanAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-crm-data";
                        } else {
                            document.getElementById("menu-item-crm-data").style.display = "none";
                        }
                        if (vtObj.permissions.letan) {
                            document.getElementById("menu-item-dat-lich-hen").style.display = "flex";
                            letanAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-dat-lich-hen";
                        } else {
                            document.getElementById("menu-item-dat-lich-hen").style.display = "none";
                        }
                        if (vtObj.permissions.taikham) {
                            document.getElementById("menu-item-tai-kham").style.display = "flex";
                            letanAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-tai-kham";
                        } else {
                            document.getElementById("menu-item-tai-kham").style.display = "none";
                        }
                        if (vtObj.permissions.lichphauthuat) {
                            document.getElementById("menu-item-lich-phau-thuat").style.display = "flex";
                            letanAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-lich-phau-thuat";
                        } else {
                            document.getElementById("menu-item-lich-phau-thuat").style.display = "none";
                        }
                        if (letanAnyAllowed) {
                            document.getElementById("menu-item-le-tan").style.display = "flex";
                        } else {
                            document.getElementById("menu-item-le-tan").style.display = "none";
                            document.getElementById("submenu-le-tan").classList.remove("open");
                        }

                        // CRM: phân quyền cho sub-menu "Danh sách khách hàng"
                        if (vtObj.permissions.crmkhachhang) {
                            document.getElementById("menu-item-crm-khach-hang").style.display = "flex";
                            document.getElementById("menu-item-crm").style.display = "flex";
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-crm-khach-hang";
                        } else {
                            document.getElementById("menu-item-crm-khach-hang").style.display = "none";
                            document.getElementById("menu-item-crm").style.display = "none";
                            document.getElementById("submenu-crm").classList.remove("open");
                        }

                        // Hành chính nhân sự: phân quyền RIÊNG BIỆT cho từng sub-menu con (Quản lý văn bản /
                        // Quản lý CME) - giống mô hình đã áp dụng cho Lễ tân. Có tương thích ngược: nếu vai
                        // trò cũ chưa từng thiết lập 2 quyền mới này (undefined) nhưng đã có quyền "ketoan" cũ,
                        // vẫn coi như được phép cả 2 (tránh mất quyền truy cập đột ngột sau khi cập nhật app).
                        let hcnsAnyAllowed = false;
                        const canQuanLyVanBan = vtObj.permissions.quanlyvanban !== undefined ? vtObj.permissions.quanlyvanban : !!vtObj.permissions.ketoan;
                        const canQuanLyCme = vtObj.permissions.quanlycme !== undefined ? vtObj.permissions.quanlycme : !!vtObj.permissions.ketoan;
                        if (canQuanLyVanBan) {
                            document.getElementById("menu-item-quan-ly-van-ban").style.display = "flex";
                            hcnsAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-quan-ly-van-ban";
                        } else {
                            document.getElementById("menu-item-quan-ly-van-ban").style.display = "none";
                        }
                        if (canQuanLyCme) {
                            document.getElementById("menu-item-quan-ly-cme").style.display = "flex";
                            hcnsAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-quan-ly-cme";
                        } else {
                            document.getElementById("menu-item-quan-ly-cme").style.display = "none";
                        }
                        if (hcnsAnyAllowed) {
                            document.getElementById("menu-item-ke-toan").style.display = "flex";
                        } else {
                            document.getElementById("menu-item-ke-toan").style.display = "none";
                            document.getElementById("submenu-ke-toan").classList.remove("open");
                        }

                        // Khoa Dược: phân quyền RIÊNG BIỆT cho từng sub-menu con (Danh mục nhà cung cấp /
                        // Danh mục nhà sản xuất / Nhập liệu kho thuốc) - giống mô hình đã áp dụng cho Lễ tân.
                        let khoaDuocAnyAllowed = false;
                        if (vtObj.permissions.nhacungcap) {
                            document.getElementById("menu-item-nha-cung-cap").style.display = "flex";
                            khoaDuocAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-nha-cung-cap";
                        } else {
                            document.getElementById("menu-item-nha-cung-cap").style.display = "none";
                        }
                        if (vtObj.permissions.nhasanxuat) {
                            document.getElementById("menu-item-nha-san-xuat").style.display = "flex";
                            khoaDuocAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-nha-san-xuat";
                        } else {
                            document.getElementById("menu-item-nha-san-xuat").style.display = "none";
                        }
                        if (vtObj.permissions.donvitinh) {
                            document.getElementById("menu-item-don-vi-tinh").style.display = "flex";
                            khoaDuocAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-don-vi-tinh";
                        } else {
                            document.getElementById("menu-item-don-vi-tinh").style.display = "none";
                        }
                        if (vtObj.permissions.khoaduoc) {
                            document.getElementById("menu-item-nhap-lieu-kho-thuoc").style.display = "flex";
                            khoaDuocAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-nhap-lieu-kho-thuoc";
                        } else {
                            document.getElementById("menu-item-nhap-lieu-kho-thuoc").style.display = "none";
                        }
                        if (vtObj.permissions.phieukho) {
                            document.getElementById("menu-item-phieu-kho").style.display = "flex";
                            khoaDuocAnyAllowed = true;
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-phieu-kho";
                        } else {
                            document.getElementById("menu-item-phieu-kho").style.display = "none";
                        }
                        if (khoaDuocAnyAllowed) {
                            document.getElementById("menu-item-khoa-duoc").style.display = "flex";
                        } else {
                            document.getElementById("menu-item-khoa-duoc").style.display = "none";
                            document.getElementById("submenu-khoa-duoc").classList.remove("open");
                        }

                        if (vtObj.permissions.kythuat) {
                            document.getElementById("menu-item-ky-thuat").style.display = "flex";
                            if (!firstPanelAllowed) firstPanelAllowed = "tab-ky-thuat";
                        } else { document.getElementById("menu-item-ky-thuat").style.display = "none"; }
                    }

                    if (!firstPanelAllowed) {
                        alert("Tài khoản nhân viên của bạn chưa được cấp bất kỳ quyền truy cập phân hệ nào. Vui lòng liên hệ Admin!");
                        return;
                    }
                    setupMainWorkspace(firstPanelAllowed);
                } else {
                    logActivity('error', 'Đăng nhập', 'Đăng nhập thất bại', `Tên đăng nhập đã nhập: "${u}"`);
                    alert("Tên đăng nhập hoặc mật khẩu điều hành không chính xác!");
                    // Tự động xóa và focus lại ô mật khẩu để gõ lại ngay - không cần thao tác chuột trước.
                    // QUAN TRỌNG (lỗi đã từng bị lặp lại ở đúng chỗ này): trong Electron, việc ép focus lại
                    // cửa sổ sau khi alert() đóng là THAO TÁC BẤT ĐỒNG BỘ (qua IPC sang main process). Nếu
                    // gọi passwordInput.focus() NGAY LẬP TỨC (đồng bộ) như trước đây, nó sẽ chạy TRƯỚC KHI
                    // cửa sổ thực sự lấy lại được focus từ hệ điều hành -> ô input trông như đã được chọn
                    // nhưng bàn phím vẫn không gõ được. Phải đợi 1 nhịp (setTimeout) rồi mới focus() vào ô
                    // input cụ thể, giống hệt cơ chế đã áp dụng đúng ở forceFocusLoginInput().
                    const passwordInput = document.getElementById("password");
                    if (passwordInput) passwordInput.value = "";
                    requestElectronWindowFocus();
                    setTimeout(() => {
                        if (passwordInput) passwordInput.focus();
                    }, 150);
                }
            }
        }

        function setupMainWorkspace(targetPanelId) {
            document.getElementById("login-screen").classList.remove("active");
            document.getElementById("main-screen").classList.add("flex-active");

            highlightActiveMenu(targetPanelId);

            currentActivePanelId = targetPanelId;
            currentPage = 1;
            clearSearchInputs();
            renderCurrentPanelData();
        }

        function logout() {
            logActivity('action', 'Đăng nhập', 'Đăng xuất', currentUser ? `Nhân viên: ${currentUser.name}` : 'Tài khoản Tối Cao (Admin)');
            saveToLocalStorage();
            document.getElementById("main-screen").classList.remove("flex-active");
            document.getElementById("json-screen").classList.add("active");
            document.getElementById("username").value = "";
            document.getElementById("password").value = "";
            fileHandle = null;
            currentUser = null;
        }

        function clearSearchInputs() {
            currentSearchQuery = "";
            document.getElementById("search-nv").value = "";
            document.getElementById("search-vt").value = "";
            document.getElementById("search-pb").value = "";
            document.getElementById("search-dv").value = "";
            document.getElementById("search-lh").value = "";
            document.getElementById("search-tk").value = "";
            document.getElementById("search-pt").value = "";
            document.getElementById("search-nk").value = "";
            document.getElementById("search-nlvb").value = "";
            document.getElementById("search-lvb").value = "";
            document.getElementById("search-cd").value = "";
            document.getElementById("search-vb").value = "";
            document.getElementById("search-cme").value = "";
            document.getElementById("search-ck").value = "";
            document.getElementById("search-ncc").value = "";
            document.getElementById("search-nsx").value = "";
            document.getElementById("search-dvt").value = "";
            document.getElementById("search-th").value = "";
            document.getElementById("search-pnk").value = "";
            document.getElementById("search-pxk").value = "";
            const cdReceiverFilter = document.getElementById("filter-cd-receiver");
            if (cdReceiverFilter) cdReceiverFilter.value = "";
        }

        /* MỞ / ĐÓNG SUB-MENU CỦA MENU CHA (VD: NHẬP LIỆU LỄ TÂN -> ĐẶT LỊCH HẸN) */
        function toggleSubMenu(submenuId, parentEl) {
            const submenu = document.getElementById(submenuId);
            submenu.classList.toggle('open');
            const caret = parentEl.querySelector('.submenu-caret');
            if (caret) caret.classList.toggle('rotated');
        }

        /* Đánh dấu menu/sub-menu đang active tương ứng với targetPanelId, tự mở sub-menu chứa nó (nếu có) */
        function highlightActiveMenu(targetPanelId) {
            document.querySelectorAll(".tab-item").forEach(item => item.classList.remove("active-tab"));
            document.querySelectorAll(".tab-parent-item").forEach(item => item.classList.remove("parent-active"));
            document.querySelectorAll(".submenu-wrap").forEach(sm => sm.classList.remove("open"));
            document.querySelectorAll(".submenu-caret").forEach(c => c.classList.remove("rotated"));

            const activeItem = document.querySelector(`.tab-item[data-target="${targetPanelId}"]`);
            if (!activeItem) return;
            activeItem.classList.add("active-tab");

            const parentSubmenu = activeItem.closest(".submenu-wrap");
            if (parentSubmenu) {
                parentSubmenu.classList.add("open");
                const parentHeader = parentSubmenu.previousElementSibling;
                if (parentHeader) {
                    parentHeader.classList.add("parent-active");
                    const caret = parentHeader.querySelector(".submenu-caret");
                    if (caret) caret.classList.add("rotated");
                }
            }
        }

        /* XỬ LÝ CHUYỂN ĐỔI TAB MENU */
        function switchPanel(element) {
            const target = element.getAttribute("data-target");

            highlightActiveMenu(target);

            currentActivePanelId = target;
            currentPage = 1;
            clearSearchInputs();
            renderCurrentPanelData();
        }

        function handleSearchData() {
            if(currentActivePanelId === "tab-nhan-vien") currentSearchQuery = document.getElementById("search-nv").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-vai-tro") currentSearchQuery = document.getElementById("search-vt").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-phong-ban") currentSearchQuery = document.getElementById("search-pb").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-dich-vu") currentSearchQuery = document.getElementById("search-dv").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-dat-lich-hen") currentSearchQuery = document.getElementById("search-lh").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-tai-kham") currentSearchQuery = document.getElementById("search-tk").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-lich-phau-thuat") currentSearchQuery = document.getElementById("search-pt").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-nguon-khach") currentSearchQuery = document.getElementById("search-nk").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-nhom-loai-van-ban") currentSearchQuery = document.getElementById("search-nlvb").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-loai-van-ban") currentSearchQuery = document.getElementById("search-lvb").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-crm-data") currentSearchQuery = document.getElementById("search-cd").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-quan-ly-van-ban") currentSearchQuery = document.getElementById("search-vb").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-quan-ly-cme") currentSearchQuery = document.getElementById("search-cme").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-crm-khach-hang") currentSearchQuery = document.getElementById("search-ck").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-nha-cung-cap") currentSearchQuery = document.getElementById("search-ncc").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-nha-san-xuat") currentSearchQuery = document.getElementById("search-nsx").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-don-vi-tinh") currentSearchQuery = document.getElementById("search-dvt").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-nhap-lieu-kho-thuoc") currentSearchQuery = document.getElementById("search-th").value.trim().toLowerCase();
            if(currentActivePanelId === "tab-phieu-kho") currentSearchQuery = document.getElementById(phieuKhoViewMode === 'xuat' ? "search-pxk" : "search-pnk").value.trim().toLowerCase();
            
            currentPage = 1;
            renderCurrentPanelData();
        }

        function changePage(page) {
            currentPage = page;
            renderCurrentPanelData();
        }

        function closeModal(id) { document.getElementById(id).style.display = "none"; }

        /* MẬT KHẨU ADMIN */
        function openPasswordModal() {
            document.getElementById("old-pass").value = ""; document.getElementById("new-pass").value = ""; document.getElementById("confirm-new-pass").value = "";
            document.getElementById("password-modal").style.display = "flex";
        }
        function changePassword() {
            const oldP = document.getElementById("old-pass").value; const newP = document.getElementById("new-pass").value; const confP = document.getElementById("confirm-new-pass").value;
            if(oldP !== appData.config.adminPass) return alert("Mật khẩu hiện tại không khớp!");
            if(newP !== confP) return alert("Mật khẩu xác nhận mới sai lệch!");
            appData.config.adminPass = newP;
            saveToLocalStorage(); alert("Thay đổi mật khẩu hệ thống tối cao thành công!"); closeModal('password-modal');
        }

        /* ================= RENDERING HỆ THỐNG PHÂN TRANG ĐỘC LẬP TỪNG TAB (TỐI ĐA 20 DÒNG) ================= */
        function renderCurrentPanelData() {
            // Ẩn tất cả các Panel trước
            document.querySelectorAll(".tab-content-panel").forEach(p => p.classList.remove("panel-active"));
            // Bật Panel hiện hành
            const activePanel = document.getElementById(currentActivePanelId);
            activePanel.classList.add("panel-active");

            document.getElementById("empty-state-global").innerHTML = "";

            if (currentActivePanelId === "tab-nhan-vien") renderNhanVienTable();
            if (currentActivePanelId === "tab-vai-tro") renderVaiTroTable();
            if (currentActivePanelId === "tab-phong-ban") renderPhongBanTable();
            if (currentActivePanelId === "tab-dich-vu") renderDichVuTable();
            if (currentActivePanelId === "tab-nguon-khach") renderNguonKhachTable();
            if (currentActivePanelId === "tab-nhom-loai-van-ban") renderNhomLoaiVanBanTable();
            if (currentActivePanelId === "tab-loai-van-ban") renderLoaiVanBanTable();
            if (currentActivePanelId === "tab-dashboard-letan") renderDashboardLeTan();
            if (currentActivePanelId === "tab-crm-data") renderCrmDataTable();
            if (currentActivePanelId === "tab-quan-ly-van-ban") renderVanBanTable();
            if (currentActivePanelId === "tab-quan-ly-cme") renderCmeTable();
            if (currentActivePanelId === "tab-crm-khach-hang") renderCrmKhachHangTable();
            if (currentActivePanelId === "tab-dat-lich-hen") renderDatLichHenList();
            if (currentActivePanelId === "tab-tai-kham") renderTaiKhamList();
            if (currentActivePanelId === "tab-lich-phau-thuat") renderLichPhauThuatList();
            if (currentActivePanelId === "tab-cau-hinh-ma") renderSurgeryCodeConfigForm();
            if (currentActivePanelId === "tab-nhat-ky") renderNhatKyTable();
            if (currentActivePanelId === "tab-nha-cung-cap") renderNhaCungCapTable();
            if (currentActivePanelId === "tab-nha-san-xuat") renderNhaSanXuatTable();
            if (currentActivePanelId === "tab-don-vi-tinh") renderDonViTinhTable();
            if (currentActivePanelId === "tab-nhap-lieu-kho-thuoc") renderThuocTable();
            if (currentActivePanelId === "tab-phieu-kho" && phieuKhoViewMode === 'nhap') renderPhieuNhapKhoTable();
            if (currentActivePanelId === "tab-phieu-kho" && phieuKhoViewMode === 'xuat') renderPhieuXuatKhoTable();
        }

        // 1. XỬ LÝ BẢNG NHÂN VIÊN
        function renderNhanVienTable() {
            const body = document.getElementById("body-nhan-vien");
            const filtered = appData.nhanvien.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery) || x.username.toLowerCase().includes(currentSearchQuery));
            
            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-nv").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Không tìm thấy dữ liệu nhân sự nào tương ứng.</div>`;
                return;
            }
            document.getElementById("page-bar-nv").style.display = "flex";
            
            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-nv").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} nhân sự`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => {
                const pb = appData.phongban.find(p => p.id === x.phongBanId);
                const vt = appData.vaitro.find(v => v.id === x.vaiTroId);
                return `
                    <tr>
                        <td><strong>${x.code}</strong></td>
                        <td><div class="person-cell">${renderPersonAvatar(x.name, x.id)}<span style="font-weight:600; color:var(--dark-brown);">${x.name}${x.locked ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🔒 Đã khóa</span>' : ''}</span></div></td>
                        <td>${pb ? pb.name : '<span style="color:#bbb; font-style:italic">Chưa xếp phòng</span>'}</td>
                        <td><span style="color:var(--bronze); font-weight:500;">${vt ? vt.name : 'Chưa gán vai trò'}</span></td>
                        <td><span class="user-badge">${x.username}</span></td>
                        <td style="text-align:center;">
                            <div class="table-actions">
                                <div class="action-dropdown">
                                    <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                    <div class="action-dropdown-menu">
                                        <button type="button" onclick="openNhanVienModal('edit', '${x.id}')">✏️ Sửa</button>
                                        <button type="button" onclick="toggleNhanVienLock('${x.id}')">${x.locked ? '🔓 Mở khóa' : '🔒 Khóa'}</button>
                                        ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteNhanVien('${x.id}')">🗑️ Xóa</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            renderPaginationButtons(document.getElementById("btn-nv"), totalPages);
        }

        // Khóa/Mở khóa nhanh tài khoản nhân viên ngay từ bảng danh sách - KHÔNG xóa bất kỳ dữ liệu liên quan nào,
        // chỉ đơn thuần ngăn không cho tài khoản đó đăng nhập vào hệ thống nữa (dùng khi nhân viên đã nghỉ việc)
        function toggleNhanVienLock(id) {
            const nv = appData.nhanvien.find(x => x.id === id);
            if (!nv) return;
            const action = nv.locked ? "MỞ KHÓA" : "KHÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} tài khoản của nhân viên "${nv.name}"?\n\nThao tác này KHÔNG xóa bất kỳ dữ liệu nào đã có (lịch hẹn, lịch phẫu thuật, Data đã nhận...) - chỉ ${nv.locked ? 'cho phép' : 'ngăn'} tài khoản này đăng nhập.`)) return;
            nv.locked = !nv.locked;
            saveToLocalStorage();
            renderNhanVienTable();
        }

        function openNhanVienModal(mode, id = null) {
            const existingNv = mode === 'edit' ? appData.nhanvien.find(x => x.id === id) : null;

            // Chỉ hiển thị phòng ban/vai trò CÒN HOẠT ĐỘNG (chưa vô hiệu hóa) để chọn MỚI;
            // nếu nhân viên đang sửa đã được gán 1 phòng ban/vai trò đã bị vô hiệu hóa từ trước, vẫn giữ
            // nguyên hiển thị (kèm ghi chú) để không mất thông tin đã lưu.
            const activePhongBan = appData.phongban.filter(p => !p.disabled);
            const pbSelect = document.getElementById("nv-phongban");
            pbSelect.innerHTML = activePhongBan.map(p => `<option value="${p.id}">${p.name}</option>`).join('') || '<option value="">Chưa có phòng ban</option>';
            if (existingNv && existingNv.phongBanId && !activePhongBan.some(p => p.id === existingNv.phongBanId)) {
                const pbOutside = appData.phongban.find(p => p.id === existingNv.phongBanId);
                if (pbOutside) pbSelect.innerHTML += `<option value="${pbOutside.id}">${pbOutside.name} (Đã vô hiệu hóa)</option>`;
            }

            const activeVaiTro = appData.vaitro.filter(v => !v.disabled);
            const vtSelect = document.getElementById("nv-vaitro");
            vtSelect.innerHTML = activeVaiTro.map(v => `<option value="${v.id}">${v.name}</option>`).join('') || '<option value="">Chưa có vai trò</option>';
            if (existingNv && existingNv.vaiTroId && !activeVaiTro.some(v => v.id === existingNv.vaiTroId)) {
                const vtOutside = appData.vaitro.find(v => v.id === existingNv.vaiTroId);
                if (vtOutside) vtSelect.innerHTML += `<option value="${vtOutside.id}">${vtOutside.name} (Đã vô hiệu hóa)</option>`;
            }

            if (mode === 'add') {
                document.getElementById("title-modal-nv").innerText = "Thêm Nhân Viên Mới";
                document.getElementById("edit-nv-id").value = ""; document.getElementById("nv-code").value = "";
                document.getElementById("nv-name").value = ""; document.getElementById("nv-user").value = ""; document.getElementById("nv-pass").value = "";
                document.getElementById("nv-locked").checked = false;
            } else {
                document.getElementById("title-modal-nv").innerText = "Cập Nhật Thông Tin Nhân Viên";
                const nv = existingNv;
                document.getElementById("edit-nv-id").value = nv.id; document.getElementById("nv-code").value = nv.code;
                document.getElementById("nv-name").value = nv.name; document.getElementById("nv-phongban").value = nv.phongBanId;
                document.getElementById("nv-vaitro").value = nv.vaiTroId; document.getElementById("nv-user").value = nv.username;
                document.getElementById("nv-pass").value = nv.password;
                document.getElementById("nv-locked").checked = nv.locked || false;
            }
            document.getElementById("modal-nhan-vien").style.display = "flex";
        }

        function saveNhanVien() {
            const id = document.getElementById("edit-nv-id").value; const code = document.getElementById("nv-code").value.trim().toUpperCase();
            const name = document.getElementById("nv-name").value.trim(); const phongBanId = document.getElementById("nv-phongban").value;
            const vaiTroId = document.getElementById("nv-vaitro").value; const username = document.getElementById("nv-user").value.trim();
            const password = document.getElementById("nv-pass").value.trim();
            const locked = document.getElementById("nv-locked").checked;

            if(!code || !name || !username || !password) return alert("Vui lòng nhập đầy đủ các trường thông tin nhân sự!");
            if(username.toLowerCase() === "admin") return alert("Không được phép trùng tên tài khoản hệ thống của Admin tối cao!");

            if (!id) {
                if(appData.nhanvien.some(x => x.code === code)) return alert("Mã nhân viên này đã hiện hữu!");
                if(appData.nhanvien.some(x => x.username === username)) return alert("Tên đăng nhập hệ thống này đã có người sử dụng!");
                appData.nhanvien.push({ id: generateUniqueId("nv"), code, name, phongBanId, vaiTroId, username, password, locked });
                logActivity('action', 'Nhân viên', 'Thêm mới', `${code} - ${name}`);
            } else {
                const nv = appData.nhanvien.find(x => x.id === id);
                if(appData.nhanvien.some(x => x.username === username && x.id !== id)) return alert("Tên đăng nhập này trùng tài khoản nhân sự khác!");
                nv.code = code; nv.name = name; nv.phongBanId = phongBanId; nv.vaiTroId = vaiTroId; nv.username = username; nv.password = password; nv.locked = locked;
                logActivity('action', 'Nhân viên', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-nhan-vien'); renderNhanVienTable();
        }

        function deleteNhanVien(id) {
            if(confirm("Xác nhận xóa nhân sự này khỏi hệ thống điều hành doanh nghiệp?")) {
                const nv = appData.nhanvien.find(x => x.id === id);
                appData.nhanvien = appData.nhanvien.filter(x => x.id !== id);
                logActivity('action', 'Nhân viên', 'Xóa', nv ? `${nv.code} - ${nv.name}` : id);
                saveToLocalStorage(); renderNhanVienTable();
            }
        }

        // 2. XỬ LÝ BẢNG VAI TRÒ & PHÂN QUYỀN
        function renderVaiTroTable() {
            const body = document.getElementById("body-vai-tro");
            const filtered = appData.vaitro.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));
            
            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-vt").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có vai trò chức vụ nào tương ứng.</div>`;
                return;
            }
            document.getElementById("page-bar-vt").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-vt").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} chức vụ`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => {
                let textPerms = [];
                if(x.permissions?.dashboardletan) textPerms.push("📊 Lễ tân - Dashboard");
                if(x.permissions?.crmdata) textPerms.push("📥 Lễ tân - Danh sách Data");
                if(x.permissions?.letan) textPerms.push("📅 Lễ tân - Đặt lịch hẹn tư vấn");
                if(x.permissions?.taikham) textPerms.push("🩹 Lễ tân - Tái khám, thay băng, cắt chỉ");
                if(x.permissions?.lichphauthuat) textPerms.push("🏥 Lễ tân - Danh sách lịch phẫu thuật");
                if(x.permissions?.crmkhachhang) textPerms.push("🧑‍🤝‍🧑 CRM - Khách hàng");
                const showVanBan = x.permissions?.quanlyvanban !== undefined ? x.permissions.quanlyvanban : !!x.permissions?.ketoan;
                const showCme = x.permissions?.quanlycme !== undefined ? x.permissions.quanlycme : !!x.permissions?.ketoan;
                if (showVanBan) textPerms.push("📑 HCNS - Quản Lý Văn Bản");
                if (showCme) textPerms.push("🎓 HCNS - Quản Lý CME");
                if(x.permissions?.khoaduoc) textPerms.push("💊 Khoa Dược - Thuốc và Tồn kho");
                if(x.permissions?.phieukho) textPerms.push("📋 Khoa Dược - Phiếu xuất / nhập kho");
                if(x.permissions?.nhacungcap) textPerms.push("🚚 Khoa Dược - Danh mục nhà cung cấp");
                if(x.permissions?.nhasanxuat) textPerms.push("🏭 Khoa Dược - Danh mục nhà sản xuất");
                if(x.permissions?.donvitinh) textPerms.push("📏 Khoa Dược - Danh mục đơn vị tính");
                if(x.permissions?.kythuat) textPerms.push("🔧 Thao tác Kỹ thuật");
                return `
                    <tr>
                        <td style="font-weight:600;">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                        <td><span style="font-family:monospace; background:#f5f5f5; padding:2px 6px; border-radius:4px;">${x.code}</span></td>
                        <td style="font-size:13px; color:var(--success); font-weight:500;">${textPerms.join(', ') || '<span style="color:#bbb; font-style:italic">Chưa phân quyền nào</span>'}</td>
                        <td style="text-align:center;">
                            <div class="table-actions">
                                <div class="action-dropdown">
                                    <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                    <div class="action-dropdown-menu">
                                        <button type="button" onclick="openVaiTroModal('edit', '${x.id}')">✏️ Sửa Quyền</button>
                                        <button type="button" onclick="toggleVaiTroDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                        ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteVaiTro('${x.id}')">🗑️ Xóa</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            renderPaginationButtons(document.getElementById("btn-vt"), totalPages);
        }

        function toggleVaiTroDisabled(id) {
            const vt = appData.vaitro.find(x => x.id === id);
            if (!vt) return;
            const action = vt.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} vai trò "${vt.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện vai trò này khỏi danh sách chọn khi gán MỚI cho nhân viên.`)) return;
            vt.disabled = !vt.disabled;
            saveToLocalStorage();
            renderVaiTroTable();
        }

        function openVaiTroModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-vt").innerText = "Thêm Vai Trò & Thiết Lập Quyền";
                document.getElementById("edit-vt-id").value = ""; document.getElementById("vt-name").value = ""; document.getElementById("vt-code").value = "";
                document.getElementById("perm-le-tan").checked = false; document.getElementById("perm-ky-thuat").checked = false;
                document.getElementById("perm-quan-ly-van-ban").checked = false; document.getElementById("perm-quan-ly-cme").checked = false;
                document.getElementById("perm-crm-data").checked = false; document.getElementById("perm-crm-khach-hang").checked = false;
                document.getElementById("perm-tai-kham").checked = false;
                document.getElementById("perm-lich-phau-thuat").checked = false;
                document.getElementById("perm-dashboard-letan").checked = false;
                document.getElementById("perm-khoa-duoc").checked = false;
                document.getElementById("perm-phieu-kho").checked = false;
                document.getElementById("perm-nha-cung-cap").checked = false;
                document.getElementById("perm-nha-san-xuat").checked = false;
                document.getElementById("perm-don-vi-tinh").checked = false;
                document.getElementById("vt-disabled").checked = false;
            } else {
                document.getElementById("title-modal-vt").innerText = "Chỉnh Sửa Quyền Hạn Chức Vụ";
                const vt = appData.vaitro.find(x => x.id === id);
                document.getElementById("edit-vt-id").value = vt.id; document.getElementById("vt-name").value = vt.name; document.getElementById("vt-code").value = vt.code;
                document.getElementById("perm-le-tan").checked = vt.permissions?.letan || false;
                document.getElementById("perm-ky-thuat").checked = vt.permissions?.kythuat || false;
                // Tương thích ngược: nếu vai trò cũ chưa từng có 2 quyền riêng biệt này (undefined) nhưng đã
                // có quyền "ketoan" cũ (gộp chung) -> tự động điền sẵn cả 2 ô tick để không mất quyền khi sửa lại
                document.getElementById("perm-quan-ly-van-ban").checked = vt.permissions?.quanlyvanban !== undefined ? vt.permissions.quanlyvanban : !!vt.permissions?.ketoan;
                document.getElementById("perm-quan-ly-cme").checked = vt.permissions?.quanlycme !== undefined ? vt.permissions.quanlycme : !!vt.permissions?.ketoan;
                document.getElementById("perm-crm-data").checked = vt.permissions?.crmdata || false;
                document.getElementById("perm-crm-khach-hang").checked = vt.permissions?.crmkhachhang || false;
                document.getElementById("perm-tai-kham").checked = vt.permissions?.taikham || false;
                document.getElementById("perm-lich-phau-thuat").checked = vt.permissions?.lichphauthuat || false;
                document.getElementById("perm-dashboard-letan").checked = vt.permissions?.dashboardletan || false;
                document.getElementById("perm-khoa-duoc").checked = vt.permissions?.khoaduoc || false;
                document.getElementById("perm-phieu-kho").checked = vt.permissions?.phieukho || false;
                document.getElementById("perm-nha-cung-cap").checked = vt.permissions?.nhacungcap || false;
                document.getElementById("perm-nha-san-xuat").checked = vt.permissions?.nhasanxuat || false;
                document.getElementById("perm-don-vi-tinh").checked = vt.permissions?.donvitinh || false;
                document.getElementById("vt-disabled").checked = vt.disabled || false;
            }
            document.getElementById("modal-vai-tro").style.display = "flex";
        }

        function saveVaiTro() {
            const id = document.getElementById("edit-vt-id").value; const name = document.getElementById("vt-name").value.trim(); const code = document.getElementById("vt-code").value.trim().toUpperCase();
            const letan = document.getElementById("perm-le-tan").checked; const kythuat = document.getElementById("perm-ky-thuat").checked;
            const quanlyvanban = document.getElementById("perm-quan-ly-van-ban").checked; const quanlycme = document.getElementById("perm-quan-ly-cme").checked;
            const crmdata = document.getElementById("perm-crm-data").checked; const crmkhachhang = document.getElementById("perm-crm-khach-hang").checked;
            const taikham = document.getElementById("perm-tai-kham").checked;
            const lichphauthuat = document.getElementById("perm-lich-phau-thuat").checked;
            const dashboardletan = document.getElementById("perm-dashboard-letan").checked;
            const khoaduoc = document.getElementById("perm-khoa-duoc").checked;
            const phieukho = document.getElementById("perm-phieu-kho").checked;
            const nhacungcap = document.getElementById("perm-nha-cung-cap").checked;
            const nhasanxuat = document.getElementById("perm-nha-san-xuat").checked;
            const donvitinh = document.getElementById("perm-don-vi-tinh").checked;
            const disabled = document.getElementById("vt-disabled").checked;

            if(!name || !code) return alert("Vui lòng điền tên vai trò và mã vai trò!");

            if (!id) {
                if(appData.vaitro.some(x => x.code === code)) return alert("Mã vai trò chức vụ này đã hiện hữu!");
                appData.vaitro.push({ id: generateUniqueId("vt"), name, code, disabled, permissions: { letan, kythuat, crmdata, crmkhachhang, taikham, lichphauthuat, dashboardletan, quanlyvanban, quanlycme, khoaduoc, phieukho, nhacungcap, nhasanxuat, donvitinh } });
                logActivity('action', 'Vai trò', 'Thêm mới', `${code} - ${name}`);
            } else {
                const vt = appData.vaitro.find(x => x.id === id);
                vt.name = name; vt.code = code; vt.disabled = disabled; vt.permissions = { letan, kythuat, crmdata, crmkhachhang, taikham, lichphauthuat, dashboardletan, quanlyvanban, quanlycme, khoaduoc, phieukho, nhacungcap, nhasanxuat, donvitinh };
                logActivity('action', 'Vai trò', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-vai-tro'); renderVaiTroTable();
        }

        function deleteVaiTro(id) {
            if(confirm("Xóa chức vụ này đồng nghĩa rút toàn bộ quyền hạn liên quan. Bạn có chắc không?")) {
                const vt = appData.vaitro.find(x => x.id === id);
                appData.vaitro = appData.vaitro.filter(x => x.id !== id);
                logActivity('action', 'Vai trò', 'Xóa', vt ? `${vt.code} - ${vt.name}` : id);
                saveToLocalStorage(); renderVaiTroTable();
            }
        }

        // 3. XỬ LÝ BẢNG PHÒNG BAN
        function renderPhongBanTable() {
            const body = document.getElementById("body-phong-ban");
            const filtered = appData.phongban.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));
            
            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-pb").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa cấu hình phòng ban nào.</div>`;
                return;
            }
            document.getElementById("page-bar-pb").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-pb").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} phòng ban`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                    <td style="font-size:13px; color:var(--gray-text);">${x.desc || '<span style="color:#ccc">Không có mô tả</span>'}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openPhongBanModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="togglePhongBanDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deletePhongBan('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-pb"), totalPages);
        }

        function togglePhongBanDisabled(id) {
            const pb = appData.phongban.find(x => x.id === id);
            if (!pb) return;
            const action = pb.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} phòng ban "${pb.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện phòng ban này khỏi danh sách chọn khi gán MỚI cho nhân viên.`)) return;
            pb.disabled = !pb.disabled;
            saveToLocalStorage();
            renderPhongBanTable();
        }

        function openPhongBanModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-pb").innerText = "Tạo Phòng Ban Mới";
                document.getElementById("edit-pb-id").value = ""; document.getElementById("pb-code").value = "";
                document.getElementById("pb-name").value = ""; document.getElementById("pb-desc").value = "";
                document.getElementById("pb-disabled").checked = false;
            } else {
                document.getElementById("title-modal-pb").innerText = "Cập Nhật Phòng Ban";
                const pb = appData.phongban.find(x => x.id === id);
                document.getElementById("edit-pb-id").value = pb.id; document.getElementById("pb-code").value = pb.code;
                document.getElementById("pb-name").value = pb.name; document.getElementById("pb-desc").value = pb.desc || "";
                document.getElementById("pb-disabled").checked = pb.disabled || false;
            }
            document.getElementById("modal-phong-ban").style.display = "flex";
        }

        function savePhongBan() {
            const id = document.getElementById("edit-pb-id").value; const code = document.getElementById("pb-code").value.trim().toUpperCase();
            const name = document.getElementById("pb-name").value.trim(); const desc = document.getElementById("pb-desc").value.trim();
            const disabled = document.getElementById("pb-disabled").checked;

            if(!code || !name) return alert("Vui lòng điền đủ Mã phòng và Tên phòng ban!");

            if (!id) {
                if(appData.phongban.some(x => x.code === code)) return alert("Mã phòng ban này đã có trước đó!");
                appData.phongban.push({ id: generateUniqueId("pb"), code, name, desc, disabled });
                logActivity('action', 'Phòng ban', 'Thêm mới', `${code} - ${name}`);
            } else {
                const pb = appData.phongban.find(x => x.id === id);
                pb.code = code; pb.name = name; pb.desc = desc; pb.disabled = disabled;
                logActivity('action', 'Phòng ban', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-phong-ban'); renderPhongBanTable();
        }

        function deletePhongBan(id) {
            if(confirm("Bạn có chắc chắn muốn xóa phòng ban này?")) {
                const pb = appData.phongban.find(x => x.id === id);
                appData.phongban = appData.phongban.filter(x => x.id !== id);
                logActivity('action', 'Phòng ban', 'Xóa', pb ? `${pb.code} - ${pb.name}` : id);
                saveToLocalStorage(); renderPhongBanTable();
            }
        }

        // 4. XỬ LÝ BẢNG DANH SÁCH DỊCH VỤ
        function renderDichVuTable() {
            const body = document.getElementById("body-dich-vu");
            const filtered = appData.dichvu.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-dv").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa cấu hình dịch vụ nào.</div>`;
                return;
            }
            document.getElementById("page-bar-dv").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-dv").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} dịch vụ`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                    <td style="font-size:13px; color:var(--bronze);">${x.group || '<span style="color:#ccc; font-style:italic">Chưa phân nhóm</span>'}</td>
                    <td style="font-size:13px; color:var(--gray-text);">${x.desc || '<span style="color:#ccc">Không có mô tả</span>'}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openDichVuModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="toggleDichVuDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteDichVu('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-dv"), totalPages);
        }

        function toggleDichVuDisabled(id) {
            const dv = appData.dichvu.find(x => x.id === id);
            if (!dv) return;
            const action = dv.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} dịch vụ "${dv.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện dịch vụ này khỏi danh sách chọn khi tạo lịch hẹn/lịch phẫu thuật MỚI.`)) return;
            dv.disabled = !dv.disabled;
            saveToLocalStorage();
            renderDichVuTable();
        }

        function openDichVuModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-dv").innerText = "Thêm Dịch Vụ Mới";
                document.getElementById("edit-dv-id").value = ""; document.getElementById("dv-code").value = "";
                document.getElementById("dv-name").value = ""; document.getElementById("dv-group").value = ""; document.getElementById("dv-desc").value = "";
                document.getElementById("dv-disabled").checked = false;
            } else {
                document.getElementById("title-modal-dv").innerText = "Cập Nhật Dịch Vụ";
                const dv = appData.dichvu.find(x => x.id === id);
                document.getElementById("edit-dv-id").value = dv.id; document.getElementById("dv-code").value = dv.code;
                document.getElementById("dv-name").value = dv.name; document.getElementById("dv-group").value = dv.group || ""; document.getElementById("dv-desc").value = dv.desc || "";
                document.getElementById("dv-disabled").checked = dv.disabled || false;
            }
            document.getElementById("modal-dich-vu").style.display = "flex";
        }

        function saveDichVu() {
            const id = document.getElementById("edit-dv-id").value; const code = document.getElementById("dv-code").value.trim().toUpperCase();
            const name = document.getElementById("dv-name").value.trim(); const group = document.getElementById("dv-group").value.trim(); const desc = document.getElementById("dv-desc").value.trim();
            const disabled = document.getElementById("dv-disabled").checked;

            if(!code || !name) return alert("Vui lòng điền đủ Mã dịch vụ và Tên dịch vụ!");

            if (!id) {
                if(appData.dichvu.some(x => x.code === code)) return alert("Mã dịch vụ này đã hiện hữu!");
                appData.dichvu.push({ id: generateUniqueId("dv"), code, name, group, desc, disabled });
                logActivity('action', 'Dịch vụ', 'Thêm mới', `${code} - ${name}`);
            } else {
                const dv = appData.dichvu.find(x => x.id === id);
                dv.code = code; dv.name = name; dv.group = group; dv.desc = desc; dv.disabled = disabled;
                logActivity('action', 'Dịch vụ', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-dich-vu'); renderDichVuTable();
        }

        function deleteDichVu(id) {
            if(confirm("Bạn có chắc chắn muốn xóa dịch vụ này?")) {
                const dv = appData.dichvu.find(x => x.id === id);
                appData.dichvu = appData.dichvu.filter(x => x.id !== id);
                logActivity('action', 'Dịch vụ', 'Xóa', dv ? `${dv.code} - ${dv.name}` : id);
                saveToLocalStorage(); renderDichVuTable();
            }
        }

        // 5. XỬ LÝ BẢNG DANH SÁCH NGUỒN KHÁCH HÀNG
        function renderNguonKhachTable() {
            const body = document.getElementById("body-nguon-khach");
            const filtered = appData.nguonkhach.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-nk").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa cấu hình nguồn khách hàng nào.</div>`;
                return;
            }
            document.getElementById("page-bar-nk").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-nk").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} nguồn khách`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                    <td style="font-size:13px; color:var(--gray-text);">${x.desc || '<span style="color:#ccc">Không có mô tả</span>'}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openNguonKhachModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="toggleNguonKhachDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteNguonKhach('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-nk"), totalPages);
        }

        function toggleNguonKhachDisabled(id) {
            const nk = appData.nguonkhach.find(x => x.id === id);
            if (!nk) return;
            const action = nk.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} nguồn khách "${nk.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện nguồn khách này khỏi danh sách chọn khi tạo lịch hẹn/Data MỚI.`)) return;
            nk.disabled = !nk.disabled;
            saveToLocalStorage();
            renderNguonKhachTable();
        }

        function openNguonKhachModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-nk").innerText = "Thêm Nguồn Khách Hàng Mới";
                document.getElementById("edit-nk-id").value = ""; document.getElementById("nk-code").value = "";
                document.getElementById("nk-name").value = ""; document.getElementById("nk-desc").value = "";
                document.getElementById("nk-disabled").checked = false;
            } else {
                document.getElementById("title-modal-nk").innerText = "Cập Nhật Nguồn Khách Hàng";
                const nk = appData.nguonkhach.find(x => x.id === id);
                document.getElementById("edit-nk-id").value = nk.id; document.getElementById("nk-code").value = nk.code;
                document.getElementById("nk-name").value = nk.name; document.getElementById("nk-desc").value = nk.desc || "";
                document.getElementById("nk-disabled").checked = nk.disabled || false;
            }
            document.getElementById("modal-nguon-khach").style.display = "flex";
        }

        function saveNguonKhach() {
            const id = document.getElementById("edit-nk-id").value; const code = document.getElementById("nk-code").value.trim().toUpperCase();
            const name = document.getElementById("nk-name").value.trim(); const desc = document.getElementById("nk-desc").value.trim();
            const disabled = document.getElementById("nk-disabled").checked;

            if(!code || !name) return alert("Vui lòng điền đủ Mã nguồn khách và Tên nguồn!");

            if (!id) {
                if(appData.nguonkhach.some(x => x.code === code)) return alert("Mã nguồn khách này đã hiện hữu!");
                appData.nguonkhach.push({ id: generateUniqueId("nk"), code, name, desc, disabled });
                logActivity('action', 'Nguồn khách hàng', 'Thêm mới', `${code} - ${name}`);
            } else {
                const nk = appData.nguonkhach.find(x => x.id === id);
                nk.code = code; nk.name = name; nk.desc = desc; nk.disabled = disabled;
                logActivity('action', 'Nguồn khách hàng', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-nguon-khach'); renderNguonKhachTable();
        }

        function deleteNguonKhach(id) {
            if(confirm("Bạn có chắc chắn muốn xóa nguồn khách hàng này?")) {
                const nk = appData.nguonkhach.find(x => x.id === id);
                appData.nguonkhach = appData.nguonkhach.filter(x => x.id !== id);
                logActivity('action', 'Nguồn khách hàng', 'Xóa', nk ? `${nk.code} - ${nk.name}` : id);
                saveToLocalStorage(); renderNguonKhachTable();
            }
        }

        /* ================= DANH MỤC NHÀ CUNG CẤP (KHOA DƯỢC) =================
           Danh mục đơn giản (Tier-1, thao tác trực tiếp trên appData - không cần đọc-mới-nhất-rồi-ghi vì
           không phải loại dữ liệu nhiều người cùng sửa liên tục). Mã nhà cung cấp TỰ PHÁT SINH (không cho
           nhập tay) theo mẫu NCC0001, NCC0002... - bộ đếm chỉ tăng khi LƯU THÀNH CÔNG (không tăng khi chỉ mở
           form thêm mới rồi hủy), đúng theo quy định chung của toàn app (đã áp dụng cho Mã khách hàng/Lịch
           phẫu thuật) để tránh nhảy số oan. */
        function previewNhaCungCapCode() {
            return 'NCC' + String(appData.nhaCungCapNextNumber || 1).padStart(4, '0');
        }

        function renderNhaCungCapTable() {
            const body = document.getElementById("body-nha-cung-cap");
            const filtered = appData.nhacungcap.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-ncc").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có nhà cung cấp nào được cấu hình.</div>`;
                return;
            }
            document.getElementById("page-bar-ncc").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-ncc").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} nhà cung cấp`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                    <td>${x.phone || '<span style="color:#ccc; font-style:italic">Chưa cập nhật</span>'}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openNhaCungCapModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="toggleNhaCungCapDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteNhaCungCap('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-ncc"), totalPages);
        }

        function toggleNhaCungCapDisabled(id) {
            const ncc = appData.nhacungcap.find(x => x.id === id);
            if (!ncc) return;
            const action = ncc.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} nhà cung cấp "${ncc.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện nhà cung cấp này khỏi danh sách chọn khi nhập liệu kho thuốc MỚI.`)) return;
            ncc.disabled = !ncc.disabled;
            saveToLocalStorage();
            renderNhaCungCapTable();
        }

        function openNhaCungCapModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-ncc").innerText = "Thêm Nhà Cung Cấp Mới";
                document.getElementById("edit-ncc-id").value = "";
                document.getElementById("ncc-code").value = previewNhaCungCapCode();
                document.getElementById("ncc-name").value = "";
                document.getElementById("ncc-phone").value = "";
                document.getElementById("ncc-disabled").checked = false;
            } else {
                document.getElementById("title-modal-ncc").innerText = "Cập Nhật Nhà Cung Cấp";
                const ncc = appData.nhacungcap.find(x => x.id === id);
                document.getElementById("edit-ncc-id").value = ncc.id;
                document.getElementById("ncc-code").value = ncc.code;
                document.getElementById("ncc-name").value = ncc.name;
                document.getElementById("ncc-phone").value = ncc.phone || "";
                document.getElementById("ncc-disabled").checked = ncc.disabled || false;
            }
            document.getElementById("modal-nha-cung-cap").style.display = "flex";
        }

        function saveNhaCungCap() {
            const id = document.getElementById("edit-ncc-id").value;
            const code = document.getElementById("ncc-code").value.trim().toUpperCase();
            const name = document.getElementById("ncc-name").value.trim();
            const phone = document.getElementById("ncc-phone").value.trim();
            const disabled = document.getElementById("ncc-disabled").checked;

            if(!name) return alert("Vui lòng điền Tên nhà cung cấp!");

            if (!id) {
                appData.nhacungcap.push({ id: generateUniqueId("ncc"), code, name, phone, disabled });
                appData.nhaCungCapNextNumber = (appData.nhaCungCapNextNumber || 1) + 1; // Chỉ tăng khi LƯU THÀNH CÔNG
                logActivity('action', 'Nhà cung cấp', 'Thêm mới', `${code} - ${name}`);
            } else {
                const ncc = appData.nhacungcap.find(x => x.id === id);
                ncc.name = name; ncc.phone = phone; ncc.disabled = disabled; // Mã tự phát sinh -> không cho đổi lại khi sửa
                logActivity('action', 'Nhà cung cấp', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-nha-cung-cap'); renderNhaCungCapTable();
        }

        function deleteNhaCungCap(id) {
            if(confirm("Bạn có chắc chắn muốn xóa nhà cung cấp này?")) {
                const ncc = appData.nhacungcap.find(x => x.id === id);
                appData.nhacungcap = appData.nhacungcap.filter(x => x.id !== id);
                logActivity('action', 'Nhà cung cấp', 'Xóa', ncc ? `${ncc.code} - ${ncc.name}` : id);
                saveToLocalStorage(); renderNhaCungCapTable();
            }
        }

        /* ================= DANH MỤC NHÀ SẢN XUẤT (KHOA DƯỢC) =================
           Cấu trúc hoàn toàn tương tự Danh mục Nhà cung cấp ở trên - mã tự phát sinh theo mẫu NSX0001,
           NSX0002... chỉ tăng khi lưu thành công. */
        function previewNhaSanXuatCode() {
            return 'NSX' + String(appData.nhaSanXuatNextNumber || 1).padStart(4, '0');
        }

        function renderNhaSanXuatTable() {
            const body = document.getElementById("body-nha-san-xuat");
            const filtered = appData.nhasanxuat.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-nsx").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có nhà sản xuất nào được cấu hình.</div>`;
                return;
            }
            document.getElementById("page-bar-nsx").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-nsx").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} nhà sản xuất`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                    <td>${x.country || '<span style="color:#ccc; font-style:italic">Chưa cập nhật</span>'}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openNhaSanXuatModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="toggleNhaSanXuatDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteNhaSanXuat('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-nsx"), totalPages);
        }

        function toggleNhaSanXuatDisabled(id) {
            const nsx = appData.nhasanxuat.find(x => x.id === id);
            if (!nsx) return;
            const action = nsx.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} nhà sản xuất "${nsx.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện nhà sản xuất này khỏi danh sách chọn khi nhập liệu kho thuốc MỚI.`)) return;
            nsx.disabled = !nsx.disabled;
            saveToLocalStorage();
            renderNhaSanXuatTable();
        }

        function openNhaSanXuatModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-nsx").innerText = "Thêm Nhà Sản Xuất Mới";
                document.getElementById("edit-nsx-id").value = "";
                document.getElementById("nsx-code").value = previewNhaSanXuatCode();
                document.getElementById("nsx-name").value = "";
                document.getElementById("nsx-country").value = "";
                document.getElementById("nsx-disabled").checked = false;
            } else {
                document.getElementById("title-modal-nsx").innerText = "Cập Nhật Nhà Sản Xuất";
                const nsx = appData.nhasanxuat.find(x => x.id === id);
                document.getElementById("edit-nsx-id").value = nsx.id;
                document.getElementById("nsx-code").value = nsx.code;
                document.getElementById("nsx-name").value = nsx.name;
                document.getElementById("nsx-country").value = nsx.country || "";
                document.getElementById("nsx-disabled").checked = nsx.disabled || false;
            }
            document.getElementById("modal-nha-san-xuat").style.display = "flex";
        }

        function saveNhaSanXuat() {
            const id = document.getElementById("edit-nsx-id").value;
            const code = document.getElementById("nsx-code").value.trim().toUpperCase();
            const name = document.getElementById("nsx-name").value.trim();
            const country = document.getElementById("nsx-country").value.trim();
            const disabled = document.getElementById("nsx-disabled").checked;

            if(!name) return alert("Vui lòng điền Tên nhà sản xuất!");

            if (!id) {
                appData.nhasanxuat.push({ id: generateUniqueId("nsx"), code, name, country, disabled });
                appData.nhaSanXuatNextNumber = (appData.nhaSanXuatNextNumber || 1) + 1; // Chỉ tăng khi LƯU THÀNH CÔNG
                logActivity('action', 'Nhà sản xuất', 'Thêm mới', `${code} - ${name}`);
            } else {
                const nsx = appData.nhasanxuat.find(x => x.id === id);
                nsx.name = name; nsx.country = country; nsx.disabled = disabled; // Mã tự phát sinh -> không cho đổi lại khi sửa
                logActivity('action', 'Nhà sản xuất', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-nha-san-xuat'); renderNhaSanXuatTable();
        }

        function deleteNhaSanXuat(id) {
            if(confirm("Bạn có chắc chắn muốn xóa nhà sản xuất này?")) {
                const nsx = appData.nhasanxuat.find(x => x.id === id);
                appData.nhasanxuat = appData.nhasanxuat.filter(x => x.id !== id);
                logActivity('action', 'Nhà sản xuất', 'Xóa', nsx ? `${nsx.code} - ${nsx.name}` : id);
                saveToLocalStorage(); renderNhaSanXuatTable();
            }
        }

        /* ================= DANH MỤC ĐƠN VỊ TÍNH (KHOA DƯỢC) =================
           Danh mục đơn giản (Tier-1), MÃ NHẬP TAY (không tự phát sinh - khác với Nhà cung cấp/Nhà sản xuất),
           theo đúng cấu trúc Nguồn Khách Hàng: Mã + Tên + Ghi chú + Vô hiệu hóa. */
        function renderDonViTinhTable() {
            const body = document.getElementById("body-don-vi-tinh");
            const filtered = appData.donvitinh.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-dvt").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có đơn vị tính nào được cấu hình.</div>`;
                return;
            }
            document.getElementById("page-bar-dvt").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-dvt").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} đơn vị tính`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                    <td style="font-size:13px; color:var(--gray-text);">${x.note || '<span style="color:#ccc">Không có ghi chú</span>'}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openDonViTinhModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="toggleDonViTinhDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteDonViTinh('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-dvt"), totalPages);
        }

        function toggleDonViTinhDisabled(id) {
            const dvt = appData.donvitinh.find(x => x.id === id);
            if (!dvt) return;
            const action = dvt.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} đơn vị tính "${dvt.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện đơn vị tính này khỏi danh sách chọn khi nhập liệu kho thuốc MỚI.`)) return;
            dvt.disabled = !dvt.disabled;
            saveToLocalStorage();
            renderDonViTinhTable();
        }

        function openDonViTinhModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-dvt").innerText = "Thêm Đơn Vị Tính Mới";
                document.getElementById("edit-dvt-id").value = ""; document.getElementById("dvt-code").value = "";
                document.getElementById("dvt-name").value = ""; document.getElementById("dvt-note").value = "";
                document.getElementById("dvt-disabled").checked = false;
            } else {
                document.getElementById("title-modal-dvt").innerText = "Cập Nhật Đơn Vị Tính";
                const dvt = appData.donvitinh.find(x => x.id === id);
                document.getElementById("edit-dvt-id").value = dvt.id; document.getElementById("dvt-code").value = dvt.code;
                document.getElementById("dvt-name").value = dvt.name; document.getElementById("dvt-note").value = dvt.note || "";
                document.getElementById("dvt-disabled").checked = dvt.disabled || false;
            }
            document.getElementById("modal-don-vi-tinh").style.display = "flex";
        }

        function saveDonViTinh() {
            const id = document.getElementById("edit-dvt-id").value; const code = document.getElementById("dvt-code").value.trim().toUpperCase();
            const name = document.getElementById("dvt-name").value.trim(); const note = document.getElementById("dvt-note").value.trim();
            const disabled = document.getElementById("dvt-disabled").checked;

            if(!code || !name) return alert("Vui lòng điền đủ Mã đơn vị tính và Tên đơn vị tính!");

            if (!id) {
                if(appData.donvitinh.some(x => x.code === code)) return alert("Mã đơn vị tính này đã hiện hữu!");
                appData.donvitinh.push({ id: generateUniqueId("dvt"), code, name, note, disabled });
                logActivity('action', 'Đơn vị tính', 'Thêm mới', `${code} - ${name}`);
            } else {
                const dvt = appData.donvitinh.find(x => x.id === id);
                dvt.code = code; dvt.name = name; dvt.note = note; dvt.disabled = disabled;
                logActivity('action', 'Đơn vị tính', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-don-vi-tinh'); renderDonViTinhTable();
        }

        function deleteDonViTinh(id) {
            if(confirm("Bạn có chắc chắn muốn xóa đơn vị tính này?")) {
                const dvt = appData.donvitinh.find(x => x.id === id);
                appData.donvitinh = appData.donvitinh.filter(x => x.id !== id);
                logActivity('action', 'Đơn vị tính', 'Xóa', dvt ? `${dvt.code} - ${dvt.name}` : id);
                saveToLocalStorage(); renderDonViTinhTable();
            }
        }

        /* ================= THUỐC VÀ TỒN KHO (KHOA DƯỢC) =================
           Danh mục đơn giản (Tier-1). Mã thuốc NHẬP TAY (không tự phát sinh) nhưng KHÔNG được trùng.
           "Tồn kho hiện tại" là trường CHỈ ĐỌC, tính = Tồn đầu kỳ + tổng số lượng nhập theo phiếu nhập kho;
           do phân hệ "Phiếu nhập kho" CHƯA được xây dựng nên tạm thời luôn = Tồn đầu kỳ + 0 - khi nào có
           phân hệ nhập kho thật, chỉ cần cập nhật lại công thức tại saveThuoc() và updateThuocCurrentStockPreview(),
           không cần đổi cấu trúc dữ liệu đã lưu (đã có sẵn field currentStock trong mỗi bản ghi). */

        // ---- Tỷ lệ quy đổi đơn vị (danh sách dòng ĐỘNG: đơn vị nhỏ nhất -> trung gian -> lớn nhất) ----
        // Mỗi dòng quy đổi lưu {unitName, ratio}, trong đó "ratio" = số lượng ĐƠN VỊ LIỀN KỀ BÊN DƯỚI
        // (dòng trước đó, hoặc đơn vị nhỏ nhất nếu là dòng đầu tiên) cấu thành nên 1 đơn vị này.
        // Ví dụ: Đơn vị nhỏ nhất "Viên" -> dòng 1 "Vỉ" = 10 (Viên) -> dòng 2 "Hộp" = 10 (Vỉ, tương đương 100 Viên).
        function addQuyDoiRow(data = null) {
            const row = document.createElement('div');
            row.className = 'quy-doi-row';
            row.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px;';
            row.innerHTML = `
                <input type="text" class="qd-ten" list="datalist-don-vi-tinh" placeholder="Tên đơn vị (VD: Vỉ, Hộp, Thùng)" style="flex:2; margin-bottom:0;" oninput="updateQuyDoiLabels()">
                <span style="white-space:nowrap; font-size:13px; color:var(--gray-text);">=</span>
                <input type="number" class="qd-so-luong" placeholder="Số lượng" min="1" step="1" style="flex:1; margin-bottom:0;">
                <span class="qd-doi-vi-truoc" style="font-size:12.5px; color:var(--gray-text); white-space:nowrap; min-width:110px;"></span>
                <button type="button" class="secondary" style="width:auto; margin:0; padding:8px 12px;" onclick="removeQuyDoiRow(this)">✕</button>
            `;
            document.getElementById('th-quy-doi-list').appendChild(row);
            if (data) {
                row.querySelector('.qd-ten').value = data.unitName || '';
                row.querySelector('.qd-so-luong').value = data.ratio || '';
            }
            updateQuyDoiLabels();
        }

        function removeQuyDoiRow(btn) {
            btn.closest('.quy-doi-row').remove();
            updateQuyDoiLabels();
        }

        // Cập nhật lại nhãn "= X đơn vị ..." của TỪNG dòng theo đúng tên đơn vị liền kề bên dưới (tự động
        // dịch chuyển mỗi khi thêm/xóa/đổi tên 1 dòng bất kỳ, tránh nhãn hiển thị sai lệch thứ tự).
        function updateQuyDoiLabels() {
            const baseUnitName = document.getElementById('th-base-unit').value.trim() || 'đơn vị nhỏ nhất';
            const rows = document.querySelectorAll('#th-quy-doi-list .quy-doi-row');
            rows.forEach((row, index) => {
                const prevName = index === 0 ? baseUnitName : (rows[index - 1].querySelector('.qd-ten').value.trim() || 'đơn vị trước');
                row.querySelector('.qd-doi-vi-truoc').innerText = `đơn vị "${prevName}"`;
            });
        }

        function collectQuyDoiRows() {
            return Array.from(document.querySelectorAll('#th-quy-doi-list .quy-doi-row')).map(row => ({
                unitName: row.querySelector('.qd-ten').value.trim(),
                ratio: parseInt(row.querySelector('.qd-so-luong').value, 10) || 0
            })).filter(x => x.unitName); // Bỏ qua dòng chưa nhập tên đơn vị
        }

        function renderQuyDoiRows(conversions) {
            document.getElementById('th-quy-doi-list').innerHTML = '';
            (conversions || []).forEach(c => addQuyDoiRow(c));
        }

        // Gõ tên Nhà sản xuất (gợi ý từ Danh mục nhà sản xuất) -> tự động hiển thị đúng Nước sản xuất tương ứng
        function onThuocManufacturerChange() {
            const typed = document.getElementById('th-manufacturer').value.trim().toLowerCase();
            const matched = appData.nhasanxuat.find(n => n.name.trim().toLowerCase() === typed);
            document.getElementById('th-manufacturer-country').value = matched ? (matched.country || '') : '';
        }

        // Tồn kho hiện tại = Tồn đầu kỳ + tổng nhập theo phiếu nhập kho (mặc định +0 vì chưa có phân hệ nhập kho)
        function updateThuocCurrentStockPreview() {
            const opening = parseInt(document.getElementById('th-opening-stock').value, 10) || 0;
            document.getElementById('th-current-stock').value = opening + 0;
        }

        // Hiển thị Hàm lượng (chuỗi nhập tay tự do, VD: "500mg", "5%"...), dùng chung cho bảng danh sách
        function formatThuocStrength(x) {
            return x.strength || '<span style="color:#ccc; font-style:italic">-</span>';
        }

        function renderThuocTable() {
            const body = document.getElementById("body-th");
            const filtered = appData.thuoc.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-th").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có thuốc nào được cấu hình.</div>`;
                return;
            }
            document.getElementById("page-bar-th").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-th").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} mã thuốc`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                    <td>${x.group || '<span style="color:#ccc; font-style:italic">Chưa cập nhật</span>'}</td>
                    <td>${formatThuocStrength(x)}</td>
                    <td>${x.baseUnit || '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                    <td style="font-weight:700; color:var(--primary);">${x.currentStock ?? 0}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openThuocDetailModal('${x.id}')">👁️ Xem chi tiết</button>
                                    <button type="button" onclick="openThuocModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="toggleThuocDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteThuoc('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-th"), totalPages);
        }

        function toggleThuocDisabled(id) {
            const th = appData.thuoc.find(x => x.id === id);
            if (!th) return;
            const action = th.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} thuốc "${th.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện thuốc này khỏi danh sách chọn khi tạo phiếu nhập/xuất kho MỚI.`)) return;
            th.disabled = !th.disabled;
            saveToLocalStorage();
            renderThuocTable();
        }

        // Hiển thị danh sách Tỷ lệ quy đổi dễ hiểu, kèm quy đổi LŨY KẾ ra đơn vị nhỏ nhất (VD: "Hộp = 10 Vỉ (tương đương 100 Viên)")
        function formatQuyDoiDisplay(baseUnit, conversions) {
            if (!baseUnit && (!conversions || conversions.length === 0)) {
                return '<span style="color:#ccc; font-style:italic">Chưa cấu hình tỷ lệ quy đổi</span>';
            }
            let html = `<div>• Đơn vị nhỏ nhất (bán lẻ): <strong>${escapeHtml(baseUnit || 'Chưa đặt tên')}</strong></div>`;
            let cumulative = 1;
            (conversions || []).forEach(c => {
                cumulative *= (c.ratio || 0);
                html += `<div>• 1 <strong>${escapeHtml(c.unitName)}</strong> = ${c.ratio} đơn vị trước đó (tương đương ${cumulative} ${escapeHtml(baseUnit || '')})</div>`;
            });
            return html;
        }

        // Chuyển tab trong modal Xem Chi Tiết Thuốc (Thông tin chung / Danh sách lô / Lịch sử chỉnh sửa)
        function switchThuocDetailTab(tabName) {
            ['info', 'lo', 'pxk', 'history'].forEach(t => {
                document.getElementById(`detail-tab-btn-th-${t}`).classList.toggle("active", t === tabName);
                document.getElementById(`detail-tab-panel-th-${t}`).classList.toggle("active", t === tabName);
            });
        }

        // So sánh Hạn sử dụng với thời gian hiện tại: Hết hạn (đỏ đậm) / Sắp hết hạn trong 10 ngày (cam) / Còn hạn (xanh lá)
        function getThuocExpiryStatus(expiryDateStr) {
            if (!expiryDateStr) return { label: 'Chưa xác định', bg: '#f5f5f5', color: '#888', border: '#ccc' };
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = new Date(expiryDateStr + 'T00:00:00');
            const diffDays = Math.round((expiry - today) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) return { label: 'Hết hạn', bg: '#fdecea', color: '#8b0000', border: '#8b0000' };
            if (diffDays <= 10) return { label: 'Sắp hết hạn', bg: '#fff3e0', color: '#e65100', border: '#e65100' };
            return { label: 'Còn hạn', bg: '#e8f5e9', color: '#2e7d32', border: '#2e7d32' };
        }

        // Tab "Danh sách lô": liệt kê từng lô đang còn tồn kho của thuốc này (để đối chiếu tổng ra đúng Tồn kho hiện tại)
        function renderThuocLoTab(medicineId) {
            const body = document.getElementById("th-detail-lo-body");
            const list = appData.thuoclo.filter(l => l.medicineId === medicineId && (l.quantity || 0) > 0);
            if (list.length === 0) {
                body.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ccc; font-style:italic; padding:20px;">Chưa có lô thuốc nào trong kho.</td></tr>`;
                return;
            }
            body.innerHTML = list.map(l => {
                const st = getThuocExpiryStatus(l.expiryDate);
                return `
                <tr>
                    <td><strong>${escapeHtml(l.batchNumber)}</strong></td>
                    <td>${l.quantity}</td>
                    <td>${l.expiryDate ? formatDateVN(l.expiryDate) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                    <td><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></td>
                </tr>`;
            }).join('');
        }

        // Tab "Lịch sử chỉnh sửa": lịch sử thay đổi thông tin thuốc VÀ thay đổi tồn kho hiện tại (khi nhập kho)
        function renderThuocHistoryTab(medicine) {
            const container = document.getElementById("th-detail-history");
            const history = medicine.history || [];
            if (history.length === 0) {
                container.innerHTML = `<div class="detail-log-empty">📭 Chưa có lịch sử chỉnh sửa nào.</div>`;
                return;
            }
            const sorted = [...history].sort((a, b) => b.datetime.localeCompare(a.datetime));
            container.innerHTML = sorted.map(h => `
                <div class="detail-log-item log-type-edit">
                    <div class="detail-log-header">
                        <div class="detail-log-meta">
                            <span class="detail-log-icon">📝</span>
                            <span class="detail-log-author">${escapeHtml(h.changedBy)}</span>
                            <span class="detail-log-dot">•</span>
                            <span>${formatDatetimeVNFull(h.datetime)}</span>
                        </div>
                    </div>
                    <div class="detail-log-changes">${h.changes.map(c => `<span class="change-line">• ${escapeHtml(c)}</span>`).join('')}</div>
                </div>
            `).join('');
        }

        function openThuocDetailModal(id) {
            const th = appData.thuoc.find(x => x.id === id);
            if (!th) { alert("Thuốc này không còn tồn tại (có thể đã bị xóa)."); return; }

            document.getElementById("th-detail-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Mã Thuốc</span><span class="detail-info-value">${escapeHtml(th.code)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Tên Thuốc</span><span class="detail-info-value">${escapeHtml(th.name)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Nhóm thuốc</span><span class="detail-info-value">${th.group ? escapeHtml(th.group) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Tên hoạt chất</span><span class="detail-info-value">${th.activeIngredient ? escapeHtml(th.activeIngredient) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Hàm lượng</span><span class="detail-info-value">${th.strength ? escapeHtml(th.strength) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Dạng bào chế</span><span class="detail-info-value">${th.dosageForm ? escapeHtml(th.dosageForm) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Quy cách đóng gói</span><span class="detail-info-value">${th.packaging ? escapeHtml(th.packaging) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Đường dùng</span><span class="detail-info-value">${th.route ? escapeHtml(th.route) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Phân nhóm dược lý</span><span class="detail-info-value">${th.pharmacologyGroup ? escapeHtml(th.pharmacologyGroup) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Phân loại kê đơn</span><span class="detail-info-value">${th.prescriptionType ? escapeHtml(th.prescriptionType) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Phân loại quản lý đặc biệt</span><span class="detail-info-value">${escapeHtml(th.specialControl || 'Thường')}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Nhà sản xuất</span><span class="detail-info-value">${th.manufacturer ? escapeHtml(th.manufacturer) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Nước sản xuất</span><span class="detail-info-value">${th.manufacturerCountry ? escapeHtml(th.manufacturerCountry) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Tồn kho đầu kỳ</span><span class="detail-info-value">${th.openingStock ?? 0}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Tồn kho hiện tại</span><span class="detail-info-value" style="color:var(--primary);">${th.currentStock ?? 0} ${th.baseUnit ? escapeHtml(th.baseUnit) : ''}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Trạng thái</span><span>${th.disabled ? '<span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc;">🚫 Đã vô hiệu hóa</span>' : '<span class="appointment-status-badge" style="background:#e8f5e9; color:#2e7d32; border-color:#2e7d32;">✅ Đang hoạt động</span>'}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label" style="margin-bottom: 6px;">📐 Tỷ lệ quy đổi</span><span style="font-weight:400; line-height:1.8;">${formatQuyDoiDisplay(th.baseUnit, th.conversions)}</span></div>
            `;
            renderThuocLoTab(th.id);
            renderThuocPxkTab(th.id);
            renderThuocHistoryTab(th);
            switchThuocDetailTab('info');
            document.getElementById("modal-thuoc-detail").style.display = "flex";
        }

        function openThuocModal(mode, id = null) {
            // Nạp danh sách gợi ý Nhà sản xuất mỗi lần mở modal (lấy dữ liệu mới nhất từ Danh mục nhà sản xuất)
            document.getElementById('datalist-nha-san-xuat').innerHTML =
                appData.nhasanxuat.filter(n => !n.disabled).map(n => `<option value="${n.name}">`).join('');

            // Nạp danh sách gợi ý Đơn vị tính (dùng chung cho cả ô "Đơn vị nhỏ nhất" và tên đơn vị trong
            // từng dòng Tỷ lệ quy đổi) - lấy dữ liệu mới nhất từ Danh mục đơn vị tính
            document.getElementById('datalist-don-vi-tinh').innerHTML =
                appData.donvitinh.filter(d => !d.disabled).map(d => `<option value="${d.name}">`).join('');

            if (mode === 'add') {
                document.getElementById("title-modal-th").innerText = "Thêm Thuốc Mới";
                document.getElementById("edit-th-id").value = "";
                document.getElementById("th-code").value = "";
                document.getElementById("th-name").value = "";
                document.getElementById("th-group").value = "";
                document.getElementById("th-active-ingredient").value = "";
                document.getElementById("th-strength").value = "";
                document.getElementById("th-dosage-form").value = "";
                document.getElementById("th-packaging").value = "";
                document.getElementById("th-route").value = "";
                document.getElementById("th-pharmacology-group").value = "";
                document.getElementById("th-prescription-type").value = "";
                document.getElementById("th-special-control").value = "Thường";
                document.getElementById("th-manufacturer").value = "";
                document.getElementById("th-manufacturer-country").value = "";
                document.getElementById("th-opening-stock").value = 0;
                document.getElementById("th-current-stock").value = 0;
                document.getElementById("th-base-unit").value = "";
                renderQuyDoiRows([]);
                document.getElementById("th-disabled").checked = false;
            } else {
                document.getElementById("title-modal-th").innerText = "Cập Nhật Thuốc";
                const th = appData.thuoc.find(x => x.id === id);
                document.getElementById("edit-th-id").value = th.id;
                document.getElementById("th-code").value = th.code;
                document.getElementById("th-name").value = th.name;
                document.getElementById("th-group").value = th.group || "";
                document.getElementById("th-active-ingredient").value = th.activeIngredient || "";
                document.getElementById("th-strength").value = th.strength || "";
                document.getElementById("th-dosage-form").value = th.dosageForm || "";
                document.getElementById("th-packaging").value = th.packaging || "";
                document.getElementById("th-route").value = th.route || "";
                document.getElementById("th-pharmacology-group").value = th.pharmacologyGroup || "";
                document.getElementById("th-prescription-type").value = th.prescriptionType || "";
                document.getElementById("th-special-control").value = th.specialControl || "Thường";
                document.getElementById("th-manufacturer").value = th.manufacturer || "";
                document.getElementById("th-manufacturer-country").value = th.manufacturerCountry || "";
                document.getElementById("th-opening-stock").value = th.openingStock || 0;
                document.getElementById("th-current-stock").value = th.currentStock ?? (th.openingStock || 0);
                document.getElementById("th-base-unit").value = th.baseUnit || "";
                renderQuyDoiRows(th.conversions || []);
                document.getElementById("th-disabled").checked = th.disabled || false;
            }
            document.getElementById("modal-thuoc").style.display = "flex";
        }

        function saveThuoc() {
            const id = document.getElementById("edit-th-id").value;
            const code = document.getElementById("th-code").value.trim().toUpperCase();
            const name = document.getElementById("th-name").value.trim();
            const group = document.getElementById("th-group").value.trim();
            const activeIngredient = document.getElementById("th-active-ingredient").value.trim();
            const strength = document.getElementById("th-strength").value.trim();
            const dosageForm = document.getElementById("th-dosage-form").value.trim();
            const packaging = document.getElementById("th-packaging").value.trim();
            const route = document.getElementById("th-route").value;
            const pharmacologyGroup = document.getElementById("th-pharmacology-group").value;
            const prescriptionType = document.getElementById("th-prescription-type").value;
            const specialControl = document.getElementById("th-special-control").value;
            const manufacturer = document.getElementById("th-manufacturer").value.trim();
            const manufacturerCountry = document.getElementById("th-manufacturer-country").value.trim();
            const openingStock = parseInt(document.getElementById("th-opening-stock").value, 10) || 0;
            const baseUnit = document.getElementById("th-base-unit").value.trim();
            const conversions = collectQuyDoiRows();
            const disabled = document.getElementById("th-disabled").checked;

            if(!code || !name) return alert("Vui lòng điền đủ Mã Thuốc và Tên Thuốc!");

            if (!id) {
                if(appData.thuoc.some(x => x.code === code)) return alert("Mã thuốc này đã hiện hữu, vui lòng nhập mã khác!");
                const currentStock = openingStock; // Chưa từng có phiếu nhập kho nào -> Tồn hiện tại = Tồn đầu kỳ
                appData.thuoc.push({ id: generateUniqueId("th"), code, name, group, activeIngredient, strength, dosageForm, packaging, route, pharmacologyGroup, prescriptionType, specialControl, manufacturer, manufacturerCountry, openingStock, currentStock, baseUnit, conversions, disabled, history: [] });
                logActivity('action', 'Thuốc và Tồn kho', 'Thêm mới', `${code} - ${name}`);
            } else {
                if(appData.thuoc.some(x => x.code === code && x.id !== id)) return alert("Mã thuốc này đã hiện hữu, vui lòng nhập mã khác!");
                const th = appData.thuoc.find(x => x.id === id);

                // QUAN TRỌNG: KHÔNG ghi đè currentStock = openingStock + 0 như trước đây - làm vậy sẽ XÓA MẤT
                // toàn bộ số lượng đã được cộng vào kho qua các phiếu nhập kho trước đó. Chỉ dịch chuyển theo
                // đúng phần CHÊNH LỆCH của Tồn đầu kỳ (nếu người dùng sửa lại), giữ nguyên phần đã cộng dồn
                // từ phiếu nhập kho: currentStock_mới = openingStock_mới + (currentStock_cũ - openingStock_cũ).
                const oldOpeningStock = th.openingStock || 0;
                const stockFromReceipts = (th.currentStock ?? oldOpeningStock) - oldOpeningStock;
                const currentStock = openingStock + stockFromReceipts;

                // Ghi lịch sử chỉnh sửa: so sánh từng trường thông tin trước/sau khi lưu
                const fieldLabels = {
                    name: 'Tên Thuốc', group: 'Nhóm thuốc', activeIngredient: 'Tên hoạt chất', strength: 'Hàm lượng',
                    dosageForm: 'Dạng bào chế', packaging: 'Quy cách đóng gói', route: 'Đường dùng',
                    pharmacologyGroup: 'Phân nhóm dược lý', prescriptionType: 'Phân loại kê đơn', specialControl: 'Phân loại quản lý đặc biệt',
                    manufacturer: 'Nhà sản xuất', openingStock: 'Tồn kho đầu kỳ', baseUnit: 'Đơn vị nhỏ nhất'
                };
                const newValues = { name, group, activeIngredient, strength, dosageForm, packaging, route, pharmacologyGroup, prescriptionType, specialControl, manufacturer, openingStock, baseUnit };
                const changes = [];
                Object.entries(fieldLabels).forEach(([field, label]) => {
                    const oldVal = th[field] ?? '';
                    const newVal = newValues[field] ?? '';
                    if (String(oldVal) !== String(newVal)) {
                        changes.push(`${label}: "${oldVal || '(trống)'}" → "${newVal || '(trống)'}"`);
                    }
                });
                if (changes.length > 0) {
                    if (!th.history) th.history = [];
                    th.history.push({ datetime: new Date().toISOString(), changedBy: getCurrentSessionIdentity().name, changes });
                }

                Object.assign(th, { code, name, group, activeIngredient, strength, dosageForm, packaging, route, pharmacologyGroup, prescriptionType, specialControl, manufacturer, manufacturerCountry, openingStock, currentStock, baseUnit, conversions, disabled });
                logActivity('action', 'Thuốc và Tồn kho', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-thuoc'); renderThuocTable();
        }

        function deleteThuoc(id) {
            if(confirm("Bạn có chắc chắn muốn xóa thuốc này?")) {
                const th = appData.thuoc.find(x => x.id === id);
                appData.thuoc = appData.thuoc.filter(x => x.id !== id);
                logActivity('action', 'Thuốc và Tồn kho', 'Xóa', th ? `${th.code} - ${th.name}` : id);
                saveToLocalStorage(); renderThuocTable();
            }
        }

        /* ================= PHIẾU XUẤT / NHẬP KHO (KHOA DƯỢC) - TAB PHIẾU NHẬP KHO =================
           Một phiếu nhập kho có thể chứa NHIỀU loại thuốc, và 1 loại thuốc có thể có NHIỀU lô khác nhau
           trong cùng 1 phiếu (Số lô khác nhau -> tách thành các dòng dữ liệu riêng biệt). Luồng thao tác:
           1) Người dùng nhập thông tin 1 lô thuốc, bấm "+ Thêm Lô Vào Phiếu" -> lô được đưa vào danh sách
              tạm (currentPnkItems) hiển thị bên dưới, form được xóa trắng để tiếp tục nhập lô/thuốc khác.
           2) Khi bấm "Nhập Kho": với MỖI lô, quy đổi Số lượng + Đơn vị đã chọn về ĐƠN VỊ CƠ BẢN của thuốc
              đó (dựa theo Tỷ lệ quy đổi đã cấu hình sẵn ở Thuốc và Tồn kho), rồi mới cộng dồn vào:
                - Tồn kho hiện tại (currentStock) của đúng thuốc đó
                - Bản ghi LÔ thuốc tồn kho (thuoclo) tương ứng - nếu lô (cùng mã thuốc + cùng số lô) đã có
                  sẵn trong kho (ví dụ nhập bổ sung thêm cho 1 lô đã nhập trước đó) thì CỘNG DỒN vào lô đó,
                  chưa có thì tạo lô mới.
        */
        let phieuKhoViewMode = 'nhap';
        let currentPnkItems = []; // Danh sách lô đang tạm thêm vào phiếu (khi modal thêm phiếu đang mở)

        function setPhieuKhoViewMode(mode) {
            phieuKhoViewMode = mode;
            document.getElementById("btn-pk-view-nhap").classList.toggle("active", mode === 'nhap');
            document.getElementById("btn-pk-view-xuat").classList.toggle("active", mode === 'xuat');
            document.getElementById("phieu-kho-view-nhap").style.display = mode === 'nhap' ? 'block' : 'none';
            document.getElementById("phieu-kho-view-xuat").style.display = mode === 'xuat' ? 'block' : 'none';
            if (mode === 'nhap') { currentPage = 1; renderPhieuNhapKhoTable(); }
            if (mode === 'xuat') { currentPage = 1; renderPhieuXuatKhoTable(); }
        }

        // Quy đổi Số lượng theo Đơn vị đã chọn VỀ ĐÚNG đơn vị cơ bản (nhỏ nhất) của thuốc, dựa theo Tỷ lệ quy
        // đổi đã cấu hình. Trả về null nếu đơn vị được chọn không khớp với bất kỳ mức quy đổi nào đã cấu hình
        // (không thể quy đổi chính xác) - nơi gọi hàm này PHẢI tự kiểm tra và cảnh báo người dùng khi gặp null.
        function convertThuocQuantityToBaseUnit(medicine, quantity, unit) {
            if (!unit || unit === medicine.baseUnit) return quantity;
            let cumulative = 1;
            for (const c of (medicine.conversions || [])) {
                cumulative *= (c.ratio || 0);
                if (c.unitName === unit) return quantity * cumulative;
            }
            return null;
        }

        // Nạp lại danh sách Đơn vị tính có thể chọn (Đơn vị cơ bản + các mức quy đổi) dựa theo thuốc vừa được
        // tra cứu thấy - nếu chưa xác định được thuốc nào thì để trống, bắt người dùng chọn đúng thuốc trước.
        function populatePnkUnitOptions(medicine) {
            const select = document.getElementById('pnk-item-unit');
            if (!medicine) {
                select.innerHTML = '<option value="">-- Chọn thuốc trước --</option>';
                return;
            }
            const units = [medicine.baseUnit, ...(medicine.conversions || []).map(c => c.unitName)].filter(Boolean);
            if (units.length === 0) {
                select.innerHTML = '<option value="">-- Thuốc chưa cấu hình đơn vị tính --</option>';
                return;
            }
            select.innerHTML = units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
        }

        // Gõ/chọn Mã thuốc -> tự động tra cứu và điền Tên thuốc + nạp lại Đơn vị tính tương ứng
        function onPnkItemCodeChange() {
            const code = document.getElementById('pnk-item-code').value.trim().toUpperCase();
            const medicine = appData.thuoc.find(t => t.code === code);
            document.getElementById('pnk-item-warning').style.display = 'none';
            if (medicine) {
                document.getElementById('pnk-item-name').value = medicine.name;
                populatePnkUnitOptions(medicine);
            } else {
                populatePnkUnitOptions(null);
            }
        }

        // Gõ từ khóa Tên thuốc (chọn từ gợi ý datalist) -> tự động tra cứu và điền lại Mã thuốc + Đơn vị tính
        function onPnkItemNameChange() {
            const typed = document.getElementById('pnk-item-name').value.trim().toLowerCase();
            const medicine = appData.thuoc.find(t => t.name.trim().toLowerCase() === typed);
            document.getElementById('pnk-item-warning').style.display = 'none';
            if (medicine) {
                document.getElementById('pnk-item-code').value = medicine.code;
                populatePnkUnitOptions(medicine);
            } else {
                populatePnkUnitOptions(null);
            }
        }

        function clearPnkItemForm() {
            document.getElementById('pnk-item-code').value = '';
            document.getElementById('pnk-item-name').value = '';
            document.getElementById('pnk-item-batch').value = '';
            document.getElementById('pnk-item-order-code').value = '';
            document.getElementById('pnk-item-mfg-date').value = '';
            document.getElementById('pnk-item-exp-date').value = '';
            document.getElementById('pnk-item-qty').value = '';
            populatePnkUnitOptions(null);
            document.getElementById('pnk-item-warning').style.display = 'none';
        }

        function openPhieuNhapKhoModal() {
            document.getElementById('pnk-import-date').value = new Date().toISOString().slice(0, 10);
            // Nạp gợi ý Mã/Tên thuốc mới nhất từ Danh sách Thuốc và Tồn kho (chỉ thuốc đang hoạt động)
            const activeMeds = appData.thuoc.filter(t => !t.disabled);
            document.getElementById('datalist-thuoc-code').innerHTML = activeMeds.map(t => `<option value="${escapeHtml(t.code)}">`).join('');
            document.getElementById('datalist-thuoc-name').innerHTML = activeMeds.map(t => `<option value="${escapeHtml(t.name)}">`).join('');
            clearPnkItemForm();
            currentPnkItems = [];
            renderPnkStagingList();
            document.getElementById('modal-phieu-nhap-kho').style.display = 'flex';
        }

        // Thêm 1 lô thuốc vào danh sách tạm của phiếu (chưa lưu thật) - tra thuốc theo Mã trước, không có thì
        // tra theo Tên đã gõ; nếu không tìm thấy thuốc nào khớp thì CẢNH BÁO và KHÔNG cho thêm (đúng yêu cầu:
        // phải tra cứu xác nhận thuốc đã tồn tại trong Thuốc và Tồn kho trước khi cho nhập kho).
        function addPhieuNhapKhoItem() {
            const code = document.getElementById('pnk-item-code').value.trim().toUpperCase();
            const nameTyped = document.getElementById('pnk-item-name').value.trim();
            const batchNumber = document.getElementById('pnk-item-batch').value.trim();
            const orderCode = document.getElementById('pnk-item-order-code').value.trim();
            const manufactureDate = document.getElementById('pnk-item-mfg-date').value;
            const expiryDate = document.getElementById('pnk-item-exp-date').value;
            const quantity = parseFloat(document.getElementById('pnk-item-qty').value);
            const unit = document.getElementById('pnk-item-unit').value;
            const warningEl = document.getElementById('pnk-item-warning');

            let medicine = code ? appData.thuoc.find(t => t.code === code) : null;
            if (!medicine && nameTyped) {
                medicine = appData.thuoc.find(t => t.name.trim().toLowerCase() === nameTyped.toLowerCase());
            }

            if (!medicine) {
                warningEl.innerText = '⚠️ Không tìm thấy thuốc này trong Thuốc và Tồn kho. Vui lòng tạo thuốc trước khi nhập kho.';
                warningEl.style.display = 'block';
                return;
            }
            if (!batchNumber) { warningEl.innerText = '⚠️ Vui lòng nhập Số lô.'; warningEl.style.display = 'block'; return; }
            if (!quantity || quantity <= 0) { warningEl.innerText = '⚠️ Vui lòng nhập Số lượng hợp lệ (lớn hơn 0).'; warningEl.style.display = 'block'; return; }
            if (!unit) { warningEl.innerText = '⚠️ Vui lòng chọn Đơn vị tính.'; warningEl.style.display = 'block'; return; }

            warningEl.style.display = 'none';
            currentPnkItems.push({ medicineId: medicine.id, medicineCode: medicine.code, medicineName: medicine.name, batchNumber, orderCode, manufactureDate, expiryDate, quantity, unit });
            clearPnkItemForm();
            renderPnkStagingList();
        }

        function removePnkItem(index) {
            currentPnkItems.splice(index, 1);
            renderPnkStagingList();
        }

        // Hiển thị danh sách lô đã thêm vào phiếu, NHÓM THEO từng mã thuốc như yêu cầu
        function renderPnkStagingList() {
            const container = document.getElementById('pnk-staging-list');
            if (currentPnkItems.length === 0) {
                container.innerHTML = `<div class="empty-state" style="padding:20px;">Chưa có lô thuốc nào được thêm vào phiếu.</div>`;
                return;
            }
            const groups = {};
            currentPnkItems.forEach((item, idx) => {
                if (!groups[item.medicineCode]) groups[item.medicineCode] = { medicineName: item.medicineName, rows: [] };
                groups[item.medicineCode].rows.push({ ...item, idx });
            });
            container.innerHTML = Object.entries(groups).map(([code, group]) => `
                <div style="border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:10px; background:#fafbfd;">
                    <div style="font-weight:700; color:var(--dark-brown); margin-bottom:8px;">${escapeHtml(code)} - ${escapeHtml(group.medicineName)}</div>
                    <table style="width:100%; font-size:13px; border-collapse:collapse;">
                        <thead><tr style="color:var(--gray-text); text-align:left;"><th style="padding:4px 6px;">Số lô</th><th style="padding:4px 6px;">Mã đơn hàng</th><th style="padding:4px 6px;">NSX</th><th style="padding:4px 6px;">HSD</th><th style="padding:4px 6px;">Số lượng</th><th></th></tr></thead>
                        <tbody>
                        ${group.rows.map(it => `
                            <tr>
                                <td style="padding:4px 6px;">${escapeHtml(it.batchNumber)}</td>
                                <td style="padding:4px 6px;">${it.orderCode ? escapeHtml(it.orderCode) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                                <td style="padding:4px 6px;">${it.manufactureDate ? formatDateVN(it.manufactureDate) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                                <td style="padding:4px 6px;">${it.expiryDate ? formatDateVN(it.expiryDate) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                                <td style="padding:4px 6px; font-weight:600;">${it.quantity} ${escapeHtml(it.unit)}</td>
                                <td style="padding:4px 6px; text-align:right;"><button type="button" class="secondary" style="width:auto; margin:0; padding:3px 8px; font-size:12px;" onclick="removePnkItem(${it.idx})">✕</button></td>
                            </tr>
                        `).join('')}
                        </tbody>
                    </table>
                </div>
            `).join('');
        }

        // Xác nhận Nhập Kho: quy đổi từng lô về đơn vị cơ bản, cộng dồn vào Tồn kho hiện tại + tạo/cập nhật Lô,
        // ghi lịch sử thay đổi tồn kho, rồi lưu lại Phiếu Nhập Kho.
        function savePhieuNhapKho() {
            const importDate = document.getElementById('pnk-import-date').value;
            if (!importDate) return alert("Vui lòng chọn Ngày nhập cho phiếu!");
            if (currentPnkItems.length === 0) return alert("Vui lòng thêm ít nhất 1 lô thuốc vào phiếu trước khi nhập kho!");

            const code = 'PNK' + String(appData.phieuNhapKhoNextNumber || 1).padStart(4, '0');
            const identityName = getCurrentSessionIdentity().name; // Lấy đúng TÊN tài khoản đang đăng nhập (không lưu cả object)
            const stockDeltaByMedicine = {}; // medicineId -> tổng số lượng cộng thêm (ĐÃ quy đổi về đơn vị cơ bản)

            // Bước 1: kiểm tra quy đổi được cho TẤT CẢ các dòng TRƯỚC khi ghi bất kỳ thay đổi nào xuống dữ liệu
            // (tránh trường hợp nhập kho dở dang: vài dòng đã cộng kho, dòng sau lỗi quy đổi lại dừng giữa chừng).
            for (const item of currentPnkItems) {
                const medicine = appData.thuoc.find(t => t.id === item.medicineId);
                if (!medicine) return alert(`Thuốc mã ${item.medicineCode} không còn tồn tại, vui lòng kiểm tra lại phiếu.`);
                const converted = convertThuocQuantityToBaseUnit(medicine, item.quantity, item.unit);
                if (converted === null) {
                    return alert(`Không thể quy đổi đơn vị "${item.unit}" của thuốc ${item.medicineCode} về đơn vị cơ bản - vui lòng kiểm tra lại Tỷ lệ quy đổi đã cấu hình cho thuốc này rồi thử lại.`);
                }
            }

            // Bước 2: mọi dòng đều quy đổi hợp lệ -> tiến hành cộng dồn thật sự (đồng thời lưu lại đúng số
            // lượng ĐÃ QUY ĐỔI vào từng dòng của phiếu - để nếu sau này cần XÓA phiếu, việc hoàn tác tồn kho
            // sẽ dùng lại CHÍNH XÁC con số đã cộng lúc này, không phụ thuộc vào Tỷ lệ quy đổi có thể đã bị
            // thay đổi sau đó trên Thuốc và Tồn kho).
            for (const item of currentPnkItems) {
                const medicine = appData.thuoc.find(t => t.id === item.medicineId);
                const converted = convertThuocQuantityToBaseUnit(medicine, item.quantity, item.unit);
                item.convertedQty = converted;
                stockDeltaByMedicine[item.medicineId] = (stockDeltaByMedicine[item.medicineId] || 0) + converted;

                let lo = appData.thuoclo.find(l => l.medicineId === item.medicineId && l.batchNumber === item.batchNumber);
                if (lo) {
                    lo.quantity = (lo.quantity || 0) + converted;
                    if (item.expiryDate) lo.expiryDate = item.expiryDate;
                    if (item.manufactureDate) lo.manufactureDate = item.manufactureDate;
                } else {
                    appData.thuoclo.push({ id: generateUniqueId("lo"), medicineId: item.medicineId, batchNumber: item.batchNumber, manufactureDate: item.manufactureDate, expiryDate: item.expiryDate, quantity: converted });
                }
            }

            Object.entries(stockDeltaByMedicine).forEach(([medicineId, delta]) => {
                const medicine = appData.thuoc.find(t => t.id === medicineId);
                if (!medicine) return;
                const oldStock = medicine.currentStock || 0;
                medicine.currentStock = oldStock + delta;
                if (!medicine.history) medicine.history = [];
                medicine.history.push({
                    datetime: new Date().toISOString(),
                    changedBy: identityName,
                    changes: [`Nhập kho từ phiếu ${code}: +${delta} ${medicine.baseUnit || ''} (Tồn kho: ${oldStock} → ${medicine.currentStock})`]
                });
            });

            appData.phieunhapkho.push({ id: generateUniqueId("pnk"), code, importDate, items: currentPnkItems.map(it => ({ ...it })), createdBy: identityName, createdAt: new Date().toISOString() });
            appData.phieuNhapKhoNextNumber = (appData.phieuNhapKhoNextNumber || 1) + 1;
            logActivity('action', 'Phiếu nhập kho', 'Thêm mới', `${code} - ${currentPnkItems.length} lô thuốc`);

            saveToLocalStorage();
            closeModal('modal-phieu-nhap-kho');
            currentPnkItems = [];
            renderPhieuNhapKhoTable();
        }

        function renderPhieuNhapKhoTable() {
            const body = document.getElementById("body-pnk");
            const filtered = appData.phieunhapkho.filter(x => x.code.toLowerCase().includes(currentSearchQuery));

            if (filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-pnk").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có phiếu nhập kho nào.</div>`;
                return;
            }
            document.getElementById("page-bar-pnk").style.display = "flex";

            const sorted = [...filtered].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            const totalPages = Math.ceil(sorted.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, sorted.length);
            document.getElementById("info-pnk").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${sorted.length} phiếu nhập kho`;

            const pageData = sorted.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => {
                const soLoaiThuoc = new Set(x.items.map(i => i.medicineCode)).size;
                return `
                <tr>
                    <td><strong>${escapeHtml(x.code)}</strong></td>
                    <td>${formatDateVN(x.importDate)}</td>
                    <td>${soLoaiThuoc} loại thuốc (${x.items.length} lô)</td>
                    <td>${escapeHtml(x.createdBy || '')}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openPhieuNhapKhoDetailModal('${x.id}')">👁️ Xem chi tiết</button>
                                    <button type="button" onclick="printPhieuNhapKho('${x.id}')">🖨️ In phiếu</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deletePhieuNhapKho('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            renderPaginationButtons(document.getElementById("btn-pnk"), totalPages);
        }

        // Xóa Phiếu Nhập Kho (CHỈ Admin) - HOÀN TÁC chính xác mọi thay đổi đã áp dụng lúc nhập kho: trừ lại
        // đúng số lượng đã cộng (convertedQty đã lưu sẵn trên từng dòng) khỏi Tồn kho hiện tại và khỏi đúng
        // Lô tương ứng. Nếu việc hoàn tác khiến tồn kho hoặc lô nào bị ÂM (nghĩa là số thuốc/lô đó đã được
        // xuất kho đi nơi khác sau khi phiếu này được tạo) thì CHẶN xóa và báo rõ lý do - tránh làm sai lệch
        // dữ liệu tồn kho thực tế.
        function deletePhieuNhapKho(id) {
            const pnk = appData.phieunhapkho.find(x => x.id === id);
            if (!pnk) { alert("Phiếu nhập kho này không còn tồn tại."); return; }
            if (!confirm(`Bạn có chắc chắn muốn XÓA phiếu nhập kho "${pnk.code}"?\n\nThao tác này sẽ hoàn tác lại số lượng đã cộng vào tồn kho và các lô liên quan.`)) return;

            // Bước 1: kiểm tra TRƯỚC xem có thể hoàn tác an toàn cho TẤT CẢ các dòng hay không
            for (const item of pnk.items) {
                const medicine = appData.thuoc.find(t => t.id === item.medicineId);
                const convertedQty = item.convertedQty ?? convertThuocQuantityToBaseUnit(medicine || {}, item.quantity, item.unit) ?? 0;
                if (medicine && (medicine.currentStock || 0) - convertedQty < -0.0001) {
                    return alert(`Không thể xóa phiếu này vì Tồn kho hiện tại của thuốc "${item.medicineCode}" không đủ để hoàn tác (có thể đã được xuất kho sau khi nhập phiếu này). Vui lòng kiểm tra lại.`);
                }
                const lo = appData.thuoclo.find(l => l.medicineId === item.medicineId && l.batchNumber === item.batchNumber);
                if ((lo ? (lo.quantity || 0) : 0) - convertedQty < -0.0001) {
                    return alert(`Không thể xóa phiếu này vì Lô "${item.batchNumber}" của thuốc "${item.medicineCode}" không còn đủ số lượng để hoàn tác (có thể đã được xuất kho từ lô này sau đó). Vui lòng kiểm tra lại.`);
                }
            }

            // Bước 2: hoàn tác thật sự
            const identityName = getCurrentSessionIdentity().name;
            pnk.items.forEach(item => {
                const medicine = appData.thuoc.find(t => t.id === item.medicineId);
                const convertedQty = item.convertedQty ?? 0;
                const lo = appData.thuoclo.find(l => l.medicineId === item.medicineId && l.batchNumber === item.batchNumber);
                if (lo) {
                    lo.quantity = (lo.quantity || 0) - convertedQty;
                }
                if (medicine) {
                    const oldStock = medicine.currentStock || 0;
                    medicine.currentStock = oldStock - convertedQty;
                    if (!medicine.history) medicine.history = [];
                    medicine.history.push({
                        datetime: new Date().toISOString(),
                        changedBy: identityName,
                        changes: [`Xóa phiếu nhập kho ${pnk.code}: -${convertedQty} ${medicine.baseUnit || ''} (Tồn kho: ${oldStock} → ${medicine.currentStock})`]
                    });
                }
            });
            // Dọn các lô đã về 0 (hoặc âm do sai số làm tròn) để không hiện lô rỗng trong Danh sách lô
            appData.thuoclo = appData.thuoclo.filter(l => (l.quantity || 0) > 0.0001);

            appData.phieunhapkho = appData.phieunhapkho.filter(x => x.id !== id);
            logActivity('action', 'Phiếu nhập kho', 'Xóa', `${pnk.code} - ${pnk.items.length} lô thuốc`);
            saveToLocalStorage();
            renderPhieuNhapKhoTable();
        }

        function openPhieuNhapKhoDetailModal(id) {
            const pnk = appData.phieunhapkho.find(x => x.id === id);
            if (!pnk) { alert("Phiếu nhập kho này không còn tồn tại."); return; }

            document.getElementById("pnk-detail-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Mã phiếu</span><span class="detail-info-value">${escapeHtml(pnk.code)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Ngày nhập</span><span class="detail-info-value">${formatDateVN(pnk.importDate)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Người tạo</span><span class="detail-info-value">${escapeHtml(pnk.createdBy || '')}</span></div>
            `;

            const groups = {};
            pnk.items.forEach(item => {
                if (!groups[item.medicineCode]) groups[item.medicineCode] = { medicineName: item.medicineName, rows: [] };
                groups[item.medicineCode].rows.push(item);
            });
            document.getElementById("pnk-detail-items").innerHTML = Object.entries(groups).map(([code, group]) => `
                <div style="border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:10px; background:#fafbfd;">
                    <div style="font-weight:700; color:var(--dark-brown); margin-bottom:8px;">${escapeHtml(code)} - ${escapeHtml(group.medicineName)}</div>
                    <table style="width:100%; font-size:13px; border-collapse:collapse;">
                        <thead><tr style="color:var(--gray-text); text-align:left;"><th style="padding:4px 6px;">Số lô</th><th style="padding:4px 6px;">Mã đơn hàng</th><th style="padding:4px 6px;">NSX</th><th style="padding:4px 6px;">HSD</th><th style="padding:4px 6px;">Số lượng</th></tr></thead>
                        <tbody>
                        ${group.rows.map(it => `
                            <tr>
                                <td style="padding:4px 6px;">${escapeHtml(it.batchNumber)}</td>
                                <td style="padding:4px 6px;">${it.orderCode ? escapeHtml(it.orderCode) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                                <td style="padding:4px 6px;">${it.manufactureDate ? formatDateVN(it.manufactureDate) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                                <td style="padding:4px 6px;">${it.expiryDate ? formatDateVN(it.expiryDate) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                                <td style="padding:4px 6px; font-weight:600;">${it.quantity} ${escapeHtml(it.unit)}</td>
                            </tr>
                        `).join('')}
                        </tbody>
                    </table>
                </div>
            `).join('');

            document.getElementById("modal-phieu-nhap-kho-detail").style.display = "flex";
        }

        // In Phiếu Nhập Kho theo biểu mẫu chuẩn: đổ nội dung vào #print-area (ẩn trên màn hình bình thường)
        // rồi gọi window.print() - CSS @media print sẽ tự động chỉ hiện đúng khu vực này khi in.
        function printPhieuNhapKho(id) {
            const pnk = appData.phieunhapkho.find(x => x.id === id);
            if (!pnk) { alert("Phiếu nhập kho này không còn tồn tại."); return; }

            const rowsHtml = pnk.items.map((it, idx) => `
                <tr>
                    <td style="text-align:center;">${idx + 1}</td>
                    <td>${escapeHtml(it.medicineCode)}</td>
                    <td>${escapeHtml(it.medicineName)}</td>
                    <td>${escapeHtml(it.batchNumber)}</td>
                    <td>${it.orderCode ? escapeHtml(it.orderCode) : ''}</td>
                    <td>${it.manufactureDate ? formatDateVN(it.manufactureDate) : ''}</td>
                    <td>${it.expiryDate ? formatDateVN(it.expiryDate) : ''}</td>
                    <td style="text-align:right;">${it.quantity}</td>
                    <td>${escapeHtml(it.unit)}</td>
                </tr>
            `).join('');

            document.getElementById("print-area").innerHTML = `
                <div class="print-form-title">Phiếu Nhập Kho</div>
                <div class="print-form-subtitle">Bệnh Viện Thẩm Mỹ SaiGon Young - Khoa Dược</div>
                <div class="print-form-meta">
                    <div><strong>Mã phiếu:</strong> ${escapeHtml(pnk.code)}<br><strong>Người lập:</strong> ${escapeHtml(pnk.createdBy || '')}</div>
                    <div style="text-align:right;"><strong>Ngày nhập:</strong> ${formatDateVN(pnk.importDate)}</div>
                </div>
                <table class="print-form-table">
                    <thead>
                        <tr>
                            <th>STT</th><th>Mã thuốc</th><th>Tên thuốc</th><th>Số lô</th><th>Mã đơn hàng</th>
                            <th>NSX</th><th>HSD</th><th>Số lượng</th><th>Đơn vị</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
                <div class="print-form-signatures">
                    <div><div class="sig-title">Người Lập Phiếu</div>(Ký, ghi rõ họ tên)</div>
                    <div><div class="sig-title">Thủ Kho</div>(Ký, ghi rõ họ tên)</div>
                    <div><div class="sig-title">Trưởng Khoa Dược</div>(Ký, ghi rõ họ tên)</div>
                </div>
            `;
            window.print();
        }

        /* ================= PHIẾU XUẤT / NHẬP KHO - TAB PHIẾU XUẤT KHO =================
           Phiếu xuất kho, sau khi đã tạo, CHỈ CHO XEM VÀ IN - không cho sửa/xóa (khác với Phiếu Nhập Kho).
           Điểm khác biệt cốt lõi so với Phiếu Nhập Kho: số lượng xuất được PHÂN BỔ TỰ ĐỘNG theo nguyên tắc
           FEFO (First-Expired-First-Out - lô nào hết hạn trước thì xuất trước), người dùng không tự chọn lô. */
        let currentPxkItems = []; // Danh sách thuốc đang tạm thêm vào phiếu xuất (khi modal đang mở)

        // Lấy danh sách lô còn hàng của 1 thuốc, đã TRỪ ĐI phần đã tạm phân bổ cho các dòng KHÁC trong CÙNG
        // phiếu đang soạn (chưa lưu thật) - để nếu phiếu có 2 dòng cùng 1 thuốc thì dòng sau không bị tính
        // trùng vào phần lô mà dòng trước đã "giữ chỗ". Sắp xếp tăng dần theo Hạn sử dụng (FEFO); lô không
        // có hạn sử dụng được xếp SAU CÙNG (ưu tiên thấp nhất vì không đánh giá được mức độ khẩn cấp).
        function getAvailableBatchesForFefo(medicineId) {
            const batches = appData.thuoclo.filter(l => l.medicineId === medicineId && (l.quantity || 0) > 0).map(l => ({ ...l }));
            currentPxkItems.forEach(item => {
                if (item.medicineId !== medicineId) return;
                (item.allocations || []).forEach(a => {
                    const b = batches.find(x => x.id === a.batchId);
                    if (b) b.quantity -= a.qtyDeducted;
                });
            });
            return batches.filter(b => b.quantity > 0.0001).sort((a, b) => (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31'));
        }

        // Tính gợi ý phân bổ FEFO cho 1 lượng cần xuất (đã quy đổi về đơn vị cơ bản) của 1 thuốc
        function computeFefoAllocation(medicineId, neededQty) {
            const batches = getAvailableBatchesForFefo(medicineId);
            let remaining = neededQty;
            const allocations = [];
            for (const b of batches) {
                if (remaining <= 0.0001) break;
                const take = Math.min(b.quantity, remaining);
                allocations.push({ batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, qtyDeducted: take });
                remaining -= take;
            }
            const totalAvailable = batches.reduce((s, b) => s + b.quantity, 0);
            return { allocations, totalAvailable, sufficient: remaining <= 0.0001 };
        }

        function populatePxkUnitOptions(medicine) {
            const select = document.getElementById('pxk-item-unit');
            if (!medicine) { select.innerHTML = '<option value="">-- Chọn thuốc trước --</option>'; return; }
            const units = [medicine.baseUnit, ...(medicine.conversions || []).map(c => c.unitName)].filter(Boolean);
            if (units.length === 0) { select.innerHTML = '<option value="">-- Thuốc chưa cấu hình đơn vị tính --</option>'; return; }
            select.innerHTML = units.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
        }

        function onPxkItemCodeChange() {
            const code = document.getElementById('pxk-item-code').value.trim().toUpperCase();
            const medicine = appData.thuoc.find(t => t.code === code);
            document.getElementById('pxk-item-warning').style.display = 'none';
            if (medicine) {
                document.getElementById('pxk-item-name').value = medicine.name;
                document.getElementById('pxk-item-strength').value = medicine.strength || '';
                populatePxkUnitOptions(medicine);
            } else {
                document.getElementById('pxk-item-strength').value = '';
                populatePxkUnitOptions(null);
            }
            updatePxkFefoPreview();
        }

        function onPxkItemNameChange() {
            const typed = document.getElementById('pxk-item-name').value.trim().toLowerCase();
            const medicine = appData.thuoc.find(t => t.name.trim().toLowerCase() === typed);
            document.getElementById('pxk-item-warning').style.display = 'none';
            if (medicine) {
                document.getElementById('pxk-item-code').value = medicine.code;
                document.getElementById('pxk-item-strength').value = medicine.strength || '';
                populatePxkUnitOptions(medicine);
            } else {
                document.getElementById('pxk-item-strength').value = '';
                populatePxkUnitOptions(null);
            }
            updatePxkFefoPreview();
        }

        // Hiện gợi ý phân bổ FEFO NGAY khi người dùng nhập Số lượng/chọn Đơn vị tính - giúp thấy trước lô
        // nào sẽ bị trừ, bao nhiêu, TRƯỚC KHI bấm "Thêm Vào Phiếu".
        function updatePxkFefoPreview() {
            const previewEl = document.getElementById('pxk-fefo-preview');
            const code = document.getElementById('pxk-item-code').value.trim().toUpperCase();
            const medicine = appData.thuoc.find(t => t.code === code);
            const qty = parseFloat(document.getElementById('pxk-item-qty').value);
            const unit = document.getElementById('pxk-item-unit').value;

            if (!medicine || !qty || qty <= 0 || !unit) { previewEl.style.display = 'none'; return; }
            const converted = convertThuocQuantityToBaseUnit(medicine, qty, unit);
            if (converted === null) { previewEl.style.display = 'none'; return; }

            const result = computeFefoAllocation(medicine.id, converted);
            let html = `<strong>📋 Gợi ý phân bổ theo nguyên tắc FEFO (hết hạn trước xuất trước):</strong><br>`;
            if (result.allocations.length === 0) {
                html += `Thuốc này hiện không còn lô nào trong kho.`;
            } else {
                result.allocations.forEach(a => {
                    html += `• Lô <strong>${escapeHtml(a.batchNumber)}</strong> (HSD: ${a.expiryDate ? formatDateVN(a.expiryDate) : 'Chưa xác định'}): <strong>${a.qtyDeducted}</strong> ${escapeHtml(medicine.baseUnit || '')}<br>`;
                });
            }
            if (!result.sufficient) {
                html += `<span style="color:var(--danger); font-weight:700;">⚠️ Kho chỉ còn ${result.totalAvailable} ${escapeHtml(medicine.baseUnit || '')}, KHÔNG đủ để xuất ${converted} ${escapeHtml(medicine.baseUnit || '')} đã yêu cầu!</span>`;
                previewEl.style.background = '#fdecea'; previewEl.style.borderColor = 'var(--danger)';
            } else {
                previewEl.style.background = 'var(--primary-light)'; previewEl.style.borderColor = 'var(--primary)';
            }
            previewEl.style.display = 'block';
            previewEl.innerHTML = html;
        }

        function clearPxkItemForm() {
            document.getElementById('pxk-item-code').value = '';
            document.getElementById('pxk-item-name').value = '';
            document.getElementById('pxk-item-strength').value = '';
            document.getElementById('pxk-item-qty').value = '';
            populatePxkUnitOptions(null);
            document.getElementById('pxk-item-warning').style.display = 'none';
            document.getElementById('pxk-fefo-preview').style.display = 'none';
        }

        function openPhieuXuatKhoModal() {
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            document.getElementById('pxk-export-datetime').value = now.toISOString().slice(0, 16);
            document.getElementById('pxk-department').value = '';
            document.getElementById('pxk-customer-name').value = '';
            document.getElementById('pxk-description').value = '';
            const activeMeds = appData.thuoc.filter(t => !t.disabled);
            document.getElementById('datalist-thuoc-code-xuat').innerHTML = activeMeds.map(t => `<option value="${escapeHtml(t.code)}">`).join('');
            document.getElementById('datalist-thuoc-name-xuat').innerHTML = activeMeds.map(t => `<option value="${escapeHtml(t.name)}">`).join('');
            clearPxkItemForm();
            currentPxkItems = [];
            renderPxkStagingList();
            document.getElementById('modal-phieu-xuat-kho').style.display = 'flex';
        }

        function addPhieuXuatKhoItem() {
            const code = document.getElementById('pxk-item-code').value.trim().toUpperCase();
            const nameTyped = document.getElementById('pxk-item-name').value.trim();
            const qty = parseFloat(document.getElementById('pxk-item-qty').value);
            const unit = document.getElementById('pxk-item-unit').value;
            const warningEl = document.getElementById('pxk-item-warning');

            let medicine = code ? appData.thuoc.find(t => t.code === code) : null;
            if (!medicine && nameTyped) medicine = appData.thuoc.find(t => t.name.trim().toLowerCase() === nameTyped.toLowerCase());

            if (!medicine) { warningEl.innerText = '⚠️ Không tìm thấy thuốc này trong Thuốc và Tồn kho.'; warningEl.style.display = 'block'; return; }
            if (!qty || qty <= 0) { warningEl.innerText = '⚠️ Vui lòng nhập Số lượng hợp lệ (lớn hơn 0).'; warningEl.style.display = 'block'; return; }
            if (!unit) { warningEl.innerText = '⚠️ Vui lòng chọn Đơn vị tính.'; warningEl.style.display = 'block'; return; }

            const converted = convertThuocQuantityToBaseUnit(medicine, qty, unit);
            if (converted === null) { warningEl.innerText = `⚠️ Không thể quy đổi đơn vị "${unit}" về đơn vị cơ bản của thuốc này.`; warningEl.style.display = 'block'; return; }

            const fefo = computeFefoAllocation(medicine.id, converted);
            if (!fefo.sufficient) {
                warningEl.innerText = `⚠️ Kho chỉ còn ${fefo.totalAvailable} ${medicine.baseUnit || ''}, không đủ để xuất ${converted} ${medicine.baseUnit || ''}.`;
                warningEl.style.display = 'block';
                return;
            }

            warningEl.style.display = 'none';
            currentPxkItems.push({
                medicineId: medicine.id, medicineCode: medicine.code, medicineName: medicine.name, strength: medicine.strength || '',
                baseUnit: medicine.baseUnit || '', quantity: qty, unit, convertedQty: converted, allocations: fefo.allocations
            });
            clearPxkItemForm();
            renderPxkStagingList();
        }

        function removePxkItem(index) {
            currentPxkItems.splice(index, 1);
            renderPxkStagingList();
        }

        function renderPxkStagingList() {
            const container = document.getElementById('pxk-staging-list');
            if (currentPxkItems.length === 0) {
                container.innerHTML = `<div class="empty-state" style="padding:20px;">Chưa có thuốc nào được thêm vào phiếu.</div>`;
                return;
            }
            container.innerHTML = currentPxkItems.map((it, idx) => `
                <div style="border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:10px; background:#fafbfd;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <div style="font-weight:700; color:var(--dark-brown);">${escapeHtml(it.medicineCode)} - ${escapeHtml(it.medicineName)}${it.strength ? ' (' + escapeHtml(it.strength) + ')' : ''}</div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="font-weight:600;">${it.quantity} ${escapeHtml(it.unit)}</span>
                            <button type="button" class="secondary" style="width:auto; margin:0; padding:3px 8px; font-size:12px;" onclick="removePxkItem(${idx})">✕</button>
                        </div>
                    </div>
                    <div style="font-size:12.5px; color:var(--gray-text);">
                        ${it.allocations.map(a => `• Lô ${escapeHtml(a.batchNumber)} (HSD: ${a.expiryDate ? formatDateVN(a.expiryDate) : 'Chưa xác định'}): -${a.qtyDeducted} ${escapeHtml(it.baseUnit || '')}`).join('<br>')}
                    </div>
                </div>
            `).join('');
        }

        // Xác nhận Xuất Kho: kiểm tra lại lần cuối từng lô còn đủ số lượng đã gợi ý hay không (đề phòng dữ
        // liệu đã đổi từ lúc thêm vào tạm tới lúc bấm Xuất Kho thật), rồi mới trừ kho theo TỪNG LÔ + cập nhật
        // Tồn kho hiện tại tổng + ghi lịch sử thay đổi, cuối cùng mới lưu lại Phiếu Xuất Kho.
        function savePhieuXuatKho() {
            const exportDatetime = document.getElementById('pxk-export-datetime').value;
            if (!exportDatetime) return alert("Vui lòng chọn Ngày, giờ xuất cho phiếu!");
            if (currentPxkItems.length === 0) return alert("Vui lòng thêm ít nhất 1 thuốc vào phiếu trước khi xuất kho!");

            const department = document.getElementById('pxk-department').value.trim();
            const customerName = document.getElementById('pxk-customer-name').value.trim();
            const description = document.getElementById('pxk-description').value.trim();
            const code = 'PXK' + String(appData.phieuXuatKhoNextNumber || 1).padStart(4, '0');
            const identityName = getCurrentSessionIdentity().name;

            for (const item of currentPxkItems) {
                const medicine = appData.thuoc.find(t => t.id === item.medicineId);
                if (!medicine) return alert(`Thuốc mã ${item.medicineCode} không còn tồn tại, vui lòng kiểm tra lại phiếu.`);
                for (const a of item.allocations) {
                    const lo = appData.thuoclo.find(l => l.id === a.batchId);
                    if (!lo || (lo.quantity || 0) < a.qtyDeducted - 0.0001) {
                        return alert(`Lô "${a.batchNumber}" của thuốc ${item.medicineCode} không còn đủ số lượng để xuất (có thể vừa thay đổi). Vui lòng xóa dòng này khỏi phiếu rồi thêm lại để tính lại FEFO.`);
                    }
                }
            }

            currentPxkItems.forEach(item => {
                const medicine = appData.thuoc.find(t => t.id === item.medicineId);
                item.allocations.forEach(a => {
                    const lo = appData.thuoclo.find(l => l.id === a.batchId);
                    if (lo) lo.quantity = (lo.quantity || 0) - a.qtyDeducted;
                });
                const oldStock = medicine.currentStock || 0;
                medicine.currentStock = oldStock - item.convertedQty;
                if (!medicine.history) medicine.history = [];
                medicine.history.push({
                    datetime: new Date().toISOString(),
                    changedBy: identityName,
                    changes: [`Xuất kho theo phiếu ${code}: -${item.convertedQty} ${medicine.baseUnit || ''} (Tồn kho: ${oldStock} → ${medicine.currentStock})`]
                });
            });
            appData.thuoclo = appData.thuoclo.filter(l => (l.quantity || 0) > 0.0001);

            appData.phieuxuatkho.push({ id: generateUniqueId("pxk"), code, exportDatetime, department, customerName, description, items: currentPxkItems.map(it => ({ ...it })), createdBy: identityName, createdAt: new Date().toISOString() });
            appData.phieuXuatKhoNextNumber = (appData.phieuXuatKhoNextNumber || 1) + 1;
            logActivity('action', 'Phiếu xuất kho', 'Thêm mới', `${code} - ${currentPxkItems.length} loại thuốc`);

            saveToLocalStorage();
            closeModal('modal-phieu-xuat-kho');
            currentPxkItems = [];
            renderPhieuXuatKhoTable();
        }

        function renderPhieuXuatKhoTable() {
            const body = document.getElementById("body-pxk");
            const filtered = appData.phieuxuatkho.filter(x => x.code.toLowerCase().includes(currentSearchQuery));

            if (filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-pxk").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có phiếu xuất kho nào.</div>`;
                return;
            }
            document.getElementById("page-bar-pxk").style.display = "flex";

            const sorted = [...filtered].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            const totalPages = Math.ceil(sorted.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, sorted.length);
            document.getElementById("info-pxk").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${sorted.length} phiếu xuất kho`;

            const pageData = sorted.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => {
                const soLoaiThuoc = new Set(x.items.map(i => i.medicineCode)).size;
                return `
                <tr>
                    <td><strong>${escapeHtml(x.code)}</strong></td>
                    <td>${formatDatetimeVN(x.exportDatetime)}</td>
                    <td>${x.department ? escapeHtml(x.department) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                    <td>${x.customerName ? escapeHtml(x.customerName) : '<span style="color:#ccc; font-style:italic">-</span>'}</td>
                    <td>${soLoaiThuoc} loại thuốc</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openPhieuXuatKhoDetailModal('${x.id}')">👁️ Xem chi tiết</button>
                                    <button type="button" onclick="printPhieuXuatKho('${x.id}')">🖨️ In phiếu</button>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            renderPaginationButtons(document.getElementById("btn-pxk"), totalPages);
        }

        function openPhieuXuatKhoDetailModal(id) {
            const pxk = appData.phieuxuatkho.find(x => x.id === id);
            if (!pxk) { alert("Phiếu xuất kho này không còn tồn tại."); return; }

            document.getElementById("pxk-detail-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Mã phiếu</span><span class="detail-info-value">${escapeHtml(pxk.code)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Ngày giờ xuất</span><span class="detail-info-value">${formatDatetimeVN(pxk.exportDatetime)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Đơn vị lĩnh</span><span class="detail-info-value">${pxk.department ? escapeHtml(pxk.department) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Tên khách hàng</span><span class="detail-info-value">${pxk.customerName ? escapeHtml(pxk.customerName) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Người tạo</span><span class="detail-info-value">${escapeHtml(pxk.createdBy || '')}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Mô tả</span><span class="detail-info-value">${pxk.description ? escapeHtml(pxk.description) : '<span style="color:#ccc; font-weight:400; font-style:italic">Không có</span>'}</span></div>
            `;

            document.getElementById("pxk-detail-items").innerHTML = pxk.items.map(it => `
                <div style="border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:10px; background:#fafbfd;">
                    <div style="font-weight:700; color:var(--dark-brown); margin-bottom:6px;">${escapeHtml(it.medicineCode)} - ${escapeHtml(it.medicineName)}${it.strength ? ' (' + escapeHtml(it.strength) + ')' : ''} — <span style="color:var(--primary);">${it.quantity} ${escapeHtml(it.unit)}</span></div>
                    <div style="font-size:12.5px; color:var(--gray-text);">
                        ${(it.allocations || []).map(a => `• Lô ${escapeHtml(a.batchNumber)} (HSD: ${a.expiryDate ? formatDateVN(a.expiryDate) : 'Chưa xác định'}): -${a.qtyDeducted} ${escapeHtml(it.baseUnit || '')}`).join('<br>')}
                    </div>
                </div>
            `).join('');

            document.getElementById("modal-phieu-xuat-kho-detail").style.display = "flex";
        }

        function printPhieuXuatKho(id) {
            const pxk = appData.phieuxuatkho.find(x => x.id === id);
            if (!pxk) { alert("Phiếu xuất kho này không còn tồn tại."); return; }

            const rowsHtml = pxk.items.map((it, idx) => `
                <tr>
                    <td style="text-align:center;">${idx + 1}</td>
                    <td>${escapeHtml(it.medicineCode)}</td>
                    <td>${escapeHtml(it.medicineName)}</td>
                    <td>${it.strength ? escapeHtml(it.strength) : ''}</td>
                    <td style="text-align:right;">${it.quantity}</td>
                    <td>${escapeHtml(it.unit)}</td>
                </tr>
            `).join('');

            document.getElementById("print-area").innerHTML = `
                <div class="print-form-title">Phiếu Xuất Kho</div>
                <div class="print-form-subtitle">Bệnh Viện Thẩm Mỹ SaiGon Young - Khoa Dược</div>
                <div class="print-form-meta">
                    <div><strong>Mã phiếu:</strong> ${escapeHtml(pxk.code)}<br><strong>Đơn vị lĩnh:</strong> ${escapeHtml(pxk.department || '')}<br><strong>Khách hàng:</strong> ${escapeHtml(pxk.customerName || '')}</div>
                    <div style="text-align:right;"><strong>Ngày giờ xuất:</strong> ${formatDatetimeVN(pxk.exportDatetime)}<br><strong>Người lập:</strong> ${escapeHtml(pxk.createdBy || '')}</div>
                </div>
                ${pxk.description ? `<div style="margin-bottom:14px; font-size:13px;"><strong>Mô tả:</strong> ${escapeHtml(pxk.description)}</div>` : ''}
                <table class="print-form-table">
                    <thead><tr><th>STT</th><th>Mã thuốc</th><th>Tên thuốc</th><th>Hàm lượng</th><th>Số lượng</th><th>Đơn vị</th></tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
                <div class="print-form-signatures">
                    <div><div class="sig-title">Người Lập Phiếu</div>(Ký, ghi rõ họ tên)</div>
                    <div><div class="sig-title">Thủ Kho</div>(Ký, ghi rõ họ tên)</div>
                    <div><div class="sig-title">Người Nhận</div>(Ký, ghi rõ họ tên)</div>
                </div>
            `;
            window.print();
        }

        // Tab "Phiếu xuất" trong modal Xem Chi Tiết Thuốc: liệt kê các phiếu xuất kho có liên quan đến thuốc
        // này, kèm CHÍNH XÁC lô nào đã bị trừ bao nhiêu cho mỗi phiếu.
        function renderThuocPxkTab(medicineId) {
            const container = document.getElementById("th-detail-pxk-list");
            const relevantVouchers = appData.phieuxuatkho.filter(pxk => pxk.items.some(it => it.medicineId === medicineId));
            if (relevantVouchers.length === 0) {
                container.innerHTML = `<div class="empty-state" style="padding:20px;">Chưa có phiếu xuất kho nào liên quan đến thuốc này.</div>`;
                return;
            }
            const sorted = [...relevantVouchers].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            container.innerHTML = sorted.map(pxk => {
                const relevantItems = pxk.items.filter(it => it.medicineId === medicineId);
                return `
                <div style="border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:10px; background:#fafbfd;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <span style="font-weight:700; color:var(--dark-brown);">${escapeHtml(pxk.code)}</span>
                        <span style="font-size:12.5px; color:var(--gray-text);">${formatDatetimeVN(pxk.exportDatetime)}</span>
                    </div>
                    <div style="font-size:12.5px; color:var(--gray-text);">
                        ${relevantItems.map(it => (it.allocations || []).map(a => `• Lô ${escapeHtml(a.batchNumber)}: -${a.qtyDeducted} ${escapeHtml(it.baseUnit || '')}`).join('<br>')).join('<br>')}
                    </div>
                </div>`;
            }).join('');
        }

        /* ================= DANH SÁCH LOẠI VĂN BẢN (KÈM CẤU HÌNH MẪU SỐ TỰ SINH RIÊNG TỪNG LOẠI) ================= */
        // Định dạng mẫu số văn bản: {Số thứ tự đệm N chữ số}-{Năm hiện tại}-{Ký hiệu}, ví dụ: 0001-2026-CV
        function buildLoaiVanBanPreview(digits, nextNumber, symbol) {
            const paddedNumber = String(nextNumber || 1).padStart(Math.max(digits || 4, 1), '0');
            const year = new Date().getFullYear();
            return `${paddedNumber}/${year}/${(symbol || '???').toUpperCase()}`;
        }

        function updateLoaiVanBanPreview() {
            const digits = parseInt(document.getElementById("lvb-digits").value || "4", 10);
            const next = parseInt(document.getElementById("lvb-next").value || "1", 10);
            const symbol = document.getElementById("lvb-symbol").value;
            document.getElementById("lvb-preview").innerText = buildLoaiVanBanPreview(digits, next, symbol);
        }

        /* ================= NHÓM LOẠI VĂN BẢN (QUẢN LÝ TỐI ĐA 3 CẤP) =================
           Cấp 1: parentId = null. Cấp 2: parentId trỏ tới 1 nhóm cấp 1. Cấp 3: parentId trỏ tới 1 nhóm
           cấp 2. KHÔNG cho phép sâu hơn 3 cấp (nhóm cấp 3 không thể làm cha của nhóm nào khác nữa). */
        function getNhomLoaiVanBanLevel(id) {
            let level = 1;
            let current = appData.nhomloaivanban.find(x => x.id === id);
            const visited = new Set(); // đề phòng dữ liệu lỗi tạo vòng lặp, tránh treo trình duyệt
            while (current && current.parentId && !visited.has(current.id)) {
                visited.add(current.id);
                level++;
                current = appData.nhomloaivanban.find(x => x.id === current.parentId);
            }
            return level;
        }

        // Chiều cao cây con tính từ 1 nhóm (1 = không có con nào, 2 = có con nhưng con không có cháu, v.v...)
        function getNhomLoaiVanBanSubtreeHeight(id) {
            const children = appData.nhomloaivanban.filter(x => x.parentId === id);
            if (children.length === 0) return 1;
            return 1 + Math.max(...children.map(c => getNhomLoaiVanBanSubtreeHeight(c.id)));
        }

        // Danh sách các nhóm ĐỦ ĐIỀU KIỆN để chọn làm "Nhóm cha" khi thêm/sửa 1 nhóm (loại trừ: chính nó,
        // các nhóm con/cháu của chính nó (tránh vòng lặp), và các nhóm đã ở cấp 3 (không thể làm cha được nữa)
        function getNhomLoaiVanBanValidParentOptions(excludeId) {
            const descendantIds = new Set();
            function collectDescendants(pid) {
                appData.nhomloaivanban.filter(x => x.parentId === pid).forEach(c => {
                    descendantIds.add(c.id);
                    collectDescendants(c.id);
                });
            }
            if (excludeId) collectDescendants(excludeId);

            return appData.nhomloaivanban.filter(x => {
                if (x.id === excludeId) return false;
                if (descendantIds.has(x.id)) return false;
                if (getNhomLoaiVanBanLevel(x.id) >= 3) return false;
                return true;
            });
        }

        function renderNhomLoaiVanBanTable() {
            const body = document.getElementById("body-nhom-loai-van-ban");
            const filtered = appData.nhomloaivanban.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-nlvb").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa cấu hình nhóm loại văn bản nào.</div>`;
                return;
            }
            document.getElementById("page-bar-nlvb").style.display = "flex";

            // Sắp xếp theo cây phân cấp: cấp 1 trước, rồi tới cấp 2 trực thuộc, rồi tới cấp 3 trực thuộc -
            // dễ theo dõi cấu trúc cha/con/cháu theo đúng thứ tự
            const sorted = [];
            const addWithChildren = (node) => {
                sorted.push(node);
                filtered.filter(c => c.parentId === node.id).sort((a, b) => a.name.localeCompare(b.name)).forEach(addWithChildren);
            };
            filtered.filter(x => !x.parentId).sort((a, b) => a.name.localeCompare(b.name)).forEach(addWithChildren);
            // Phòng trường hợp nhóm con/cháu có nhóm cha bị lọc mất do không khớp từ khóa tìm kiếm
            filtered.forEach(x => { if (!sorted.includes(x)) sorted.push(x); });

            const totalPages = Math.ceil(sorted.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, sorted.length);
            document.getElementById("info-nlvb").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${sorted.length} nhóm`;

            const pageData = sorted.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => {
                const parent = x.parentId ? appData.nhomloaivanban.find(p => p.id === x.parentId) : null;
                const level = getNhomLoaiVanBanLevel(x.id);
                const indent = (level - 1) * 24;
                return `
                    <tr>
                        <td><strong>${x.code}</strong></td>
                        <td style="font-weight:600; color:var(--dark-brown); ${indent ? `padding-left:${indent + 14}px;` : ''}">${level > 1 ? '↳ ' : ''}${escapeHtml(x.name)}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                        <td>${parent ? escapeHtml(parent.name) : '<span style="color:#ccc; font-style:italic">— (Nhóm cấp 1)</span>'}</td>
                        <td style="text-align:center;">
                            <div class="table-actions">
                                <div class="action-dropdown">
                                    <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                    <div class="action-dropdown-menu">
                                        <button type="button" onclick="openNhomLoaiVanBanModal('edit', '${x.id}')">✏️ Sửa</button>
                                        <button type="button" onclick="toggleNhomLoaiVanBanDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                        ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteNhomLoaiVanBan('${x.id}')">🗑️ Xóa</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            renderPaginationButtons(document.getElementById("btn-nlvb"), totalPages);
        }

        function toggleNhomLoaiVanBanDisabled(id) {
            const nlvb = appData.nhomloaivanban.find(x => x.id === id);
            if (!nlvb) return;
            const action = nlvb.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} nhóm loại văn bản "${nlvb.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện nhóm này khỏi danh sách chọn khi cấp số văn bản MỚI.`)) return;
            nlvb.disabled = !nlvb.disabled;
            saveToLocalStorage();
            renderNhomLoaiVanBanTable();
        }

        function openNhomLoaiVanBanModal(mode, id = null) {
            const parentSelect = document.getElementById("nlvb-parent");
            const parentOptions = getNhomLoaiVanBanValidParentOptions(id);
            parentSelect.innerHTML = `<option value="">-- Không có (đây là nhóm cấp 1) --</option>` +
                parentOptions.map(p => `<option value="${p.id}">${'— '.repeat(getNhomLoaiVanBanLevel(p.id) - 1)}${escapeHtml(p.name)}</option>`).join('');

            if (mode === 'add') {
                document.getElementById("title-modal-nlvb").innerText = "Thêm Nhóm Loại Văn Bản Mới";
                document.getElementById("edit-nlvb-id").value = ""; document.getElementById("nlvb-code").value = "";
                document.getElementById("nlvb-name").value = ""; parentSelect.value = "";
                document.getElementById("nlvb-disabled").checked = false;
            } else {
                document.getElementById("title-modal-nlvb").innerText = "Cập Nhật Nhóm Loại Văn Bản";
                const nlvb = appData.nhomloaivanban.find(x => x.id === id);
                document.getElementById("edit-nlvb-id").value = nlvb.id; document.getElementById("nlvb-code").value = nlvb.code;
                document.getElementById("nlvb-name").value = nlvb.name; parentSelect.value = nlvb.parentId || "";
                document.getElementById("nlvb-disabled").checked = nlvb.disabled || false;
            }
            document.getElementById("modal-nhom-loai-van-ban").style.display = "flex";
        }

        function saveNhomLoaiVanBan() {
            const id = document.getElementById("edit-nlvb-id").value; const code = document.getElementById("nlvb-code").value.trim().toUpperCase();
            const name = document.getElementById("nlvb-name").value.trim();
            const parentId = document.getElementById("nlvb-parent").value || null;
            const disabled = document.getElementById("nlvb-disabled").checked;

            if(!code || !name) return alert("Vui lòng điền đủ Mã nhóm và Tên nhóm!");

            if (parentId) {
                if (parentId === id) return alert("Không thể chọn chính nhóm này làm nhóm cha của nó!");

                // Không cho tạo vòng lặp: không được chọn 1 nhóm con/cháu của chính nó làm nhóm cha
                let ancestorCheck = appData.nhomloaivanban.find(x => x.id === parentId);
                const visited = new Set();
                while (ancestorCheck && !visited.has(ancestorCheck.id)) {
                    if (ancestorCheck.id === id) {
                        return alert("Không thể chọn 1 nhóm CON/CHÁU của chính nó làm nhóm cha (sẽ tạo vòng lặp)!");
                    }
                    visited.add(ancestorCheck.id);
                    ancestorCheck = ancestorCheck.parentId ? appData.nhomloaivanban.find(x => x.id === ancestorCheck.parentId) : null;
                }

                const parentLevel = getNhomLoaiVanBanLevel(parentId);
                if (parentLevel >= 3) {
                    return alert("Không thể chọn nhóm này làm nhóm cha vì đã ở cấp 3 (cấp tối đa)!\n\nHệ thống chỉ hỗ trợ tối đa 3 cấp.");
                }

                // Nếu nhóm đang sửa đã có sẵn nhóm con/cháu trực thuộc, phải đảm bảo tổng số cấp không vượt quá 3
                const subtreeHeight = id ? getNhomLoaiVanBanSubtreeHeight(id) : 1;
                if (parentLevel + subtreeHeight > 3) {
                    return alert(`Không thể đặt nhóm cha này vì nhóm đang sửa đang có nhóm con/cháu trực thuộc - nếu đặt sẽ vượt quá 3 cấp tối đa cho phép!\n\nVui lòng chọn 1 nhóm cha ở cấp thấp hơn, hoặc xóa/chuyển bớt nhóm con/cháu trước.`);
                }
            }

            if (!id) {
                if(appData.nhomloaivanban.some(x => x.code === code)) return alert("Mã nhóm loại văn bản này đã hiện hữu!");
                appData.nhomloaivanban.push({ id: generateUniqueId("nlvb"), code, name, parentId, disabled });
                logActivity('action', 'Nhóm loại văn bản', 'Thêm mới', `${code} - ${name}`);
            } else {
                const nlvb = appData.nhomloaivanban.find(x => x.id === id);
                nlvb.code = code; nlvb.name = name; nlvb.parentId = parentId; nlvb.disabled = disabled;
                logActivity('action', 'Nhóm loại văn bản', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-nhom-loai-van-ban'); renderNhomLoaiVanBanTable();
        }

        function deleteNhomLoaiVanBan(id) {
            const hasChildren = appData.nhomloaivanban.some(x => x.parentId === id);
            if (hasChildren) {
                return alert("Không thể xóa nhóm này vì đang có nhóm CON/CHÁU trực thuộc!\n\nVui lòng xóa các nhóm con/cháu trước.");
            }
            if(confirm("Bạn có chắc chắn muốn xóa nhóm loại văn bản này?")) {
                const nlvb = appData.nhomloaivanban.find(x => x.id === id);
                appData.nhomloaivanban = appData.nhomloaivanban.filter(x => x.id !== id);
                logActivity('action', 'Nhóm loại văn bản', 'Xóa', nlvb ? `${nlvb.code} - ${nlvb.name}` : id);
                saveToLocalStorage(); renderNhomLoaiVanBanTable();
            }
        }

        /* ================= NHẬT KÝ HOẠT ĐỘNG (XEM LẠI LOG ĐÃ GHI QUA logActivity()) ================= */
        function formatLogDatetime(iso) {
            try {
                const d = new Date(iso);
                return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
            } catch (err) { return iso; }
        }

        function renderNhatKyTable() {
            const body = document.getElementById("body-nhat-ky");
            const query = document.getElementById("search-nk-log").value.trim().toLowerCase();
            const typeFilter = document.getElementById("nk-log-filter-type").value;

            let filtered = [...(appData.activityLogs || [])].sort((a, b) => b.datetime.localeCompare(a.datetime));
            if (typeFilter) filtered = filtered.filter(x => x.type === typeFilter);
            if (query) {
                filtered = filtered.filter(x =>
                    (x.user || '').toLowerCase().includes(query) || (x.module || '').toLowerCase().includes(query) ||
                    (x.action || '').toLowerCase().includes(query) || (x.details || '').toLowerCase().includes(query)
                );
            }

            if (filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-nk-log").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có log hoạt động nào được ghi nhận.</div>`;
                return;
            }
            document.getElementById("page-bar-nk-log").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-nk-log").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} dòng log`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td class="col-nowrap">${formatLogDatetime(x.datetime)}</td>
                    <td style="font-weight:600; color:var(--dark-brown);">${escapeHtml(x.user || '')}</td>
                    <td class="col-nowrap">${x.type === 'error' ? '<span class="appointment-status-badge" style="background:#fdecea; color:#c62828; border-color:#c62828; font-size:10.5px;">⚠️ Lỗi</span>' : '<span class="appointment-status-badge" style="background:#e8f5e9; color:#2e7d32; border-color:#2e7d32; font-size:10.5px;">✅ Hoạt động</span>'}</td>
                    <td>${escapeHtml(x.module || '')}</td>
                    <td>${escapeHtml(x.action || '')}</td>
                    <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(x.details || '')}">${escapeHtml(x.details || '')}</td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-nk-log"), totalPages);
        }

        // Cho phép Admin chủ động dọn bớt log cũ (giữ lại 200 dòng gần nhất) nếu muốn giảm dung lượng file
        // ngay lập tức, thay vì đợi tự động cắt bớt dần khi vượt quá 2000 dòng
        function clearOldActivityLogs() {
            const total = (appData.activityLogs || []).length;
            if (total <= 200) return alert("Số lượng log hiện tại còn ít (≤ 200 dòng), chưa cần dọn bớt.");
            if (!confirm(`Hiện có ${total} dòng log. Bấm OK để CHỈ GIỮ LẠI 200 dòng gần nhất (xóa ${total - 200} dòng log cũ hơn)?`)) return;
            appData.activityLogs = appData.activityLogs.slice(-200);
            saveToLocalStorage();
            currentPage = 1;
            renderNhatKyTable();
        }

        function renderLoaiVanBanTable() {
            const body = document.getElementById("body-loai-van-ban");
            const filtered = appData.loaivanban.filter(x => x.name.toLowerCase().includes(currentSearchQuery) || x.code.toLowerCase().includes(currentSearchQuery));

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-lvb").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa cấu hình loại văn bản nào.</div>`;
                return;
            }
            document.getElementById("page-bar-lvb").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-lvb").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} loại văn bản`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.name}${x.disabled ? ' <span class="appointment-status-badge" style="background:#f5f5f5; color:#888; border-color:#ccc; font-size:10px;">🚫 Đã vô hiệu hóa</span>' : ''}</td>
                    <td><span style="font-family:monospace; background:#f5f5f5; padding:2px 6px; border-radius:4px;">${x.symbol || ''}</span></td>
                    <td style="font-family:monospace; color:var(--bronze); font-weight:600;">${buildLoaiVanBanPreview(x.digits, x.nextNumber, x.symbol)}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openLoaiVanBanModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="toggleLoaiVanBanDisabled('${x.id}')">${x.disabled ? '✅ Kích hoạt' : '🚫 Vô hiệu hóa'}</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteLoaiVanBan('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-lvb"), totalPages);
        }

        function toggleLoaiVanBanDisabled(id) {
            const lvb = appData.loaivanban.find(x => x.id === id);
            if (!lvb) return;
            const action = lvb.disabled ? "KÍCH HOẠT LẠI" : "VÔ HIỆU HÓA";
            if (!confirm(`Bạn có chắc chắn muốn ${action} loại văn bản "${lvb.name}"?\n\nThao tác này KHÔNG xóa dữ liệu nào - chỉ ẩn/hiện loại văn bản này khỏi danh sách chọn khi tạo văn bản MỚI.`)) return;
            lvb.disabled = !lvb.disabled;
            saveToLocalStorage();
            renderLoaiVanBanTable();
        }

        function openLoaiVanBanModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-lvb").innerText = "Thêm Loại Văn Bản Mới";
                document.getElementById("edit-lvb-id").value = ""; document.getElementById("lvb-code").value = "";
                document.getElementById("lvb-name").value = ""; document.getElementById("lvb-symbol").value = "";
                document.getElementById("lvb-digits").value = 4; document.getElementById("lvb-next").value = 1;
                document.getElementById("lvb-disabled").checked = false;
            } else {
                document.getElementById("title-modal-lvb").innerText = "Cập Nhật Loại Văn Bản";
                const lvb = appData.loaivanban.find(x => x.id === id);
                document.getElementById("edit-lvb-id").value = lvb.id; document.getElementById("lvb-code").value = lvb.code;
                document.getElementById("lvb-name").value = lvb.name; document.getElementById("lvb-symbol").value = lvb.symbol || "";
                document.getElementById("lvb-digits").value = lvb.digits || 4; document.getElementById("lvb-next").value = lvb.nextNumber || 1;
                document.getElementById("lvb-disabled").checked = lvb.disabled || false;
            }
            updateLoaiVanBanPreview();
            document.getElementById("modal-loai-van-ban").style.display = "flex";
        }

        function saveLoaiVanBan() {
            const id = document.getElementById("edit-lvb-id").value; const code = document.getElementById("lvb-code").value.trim().toUpperCase();
            const name = document.getElementById("lvb-name").value.trim(); const symbol = document.getElementById("lvb-symbol").value.trim().toUpperCase();
            const digits = parseInt(document.getElementById("lvb-digits").value || "4", 10);
            const nextNumber = parseInt(document.getElementById("lvb-next").value || "1", 10);
            const disabled = document.getElementById("lvb-disabled").checked;

            if(!code || !name || !symbol) return alert("Vui lòng điền đủ Mã loại văn bản, Tên loại văn bản và Ký hiệu!");
            if(!digits || digits < 1) return alert("Số chữ số đệm phải lớn hơn 0!");
            if(!nextNumber || nextNumber < 1) return alert("Số bắt đầu đếm phải lớn hơn 0!");

            if (!id) {
                if(appData.loaivanban.some(x => x.code === code)) return alert("Mã loại văn bản này đã hiện hữu!");
                appData.loaivanban.push({ id: generateUniqueId("lvb"), code, name, symbol, digits, nextNumber, disabled });
                logActivity('action', 'Loại văn bản', 'Thêm mới', `${code} - ${name}`);
            } else {
                const lvb = appData.loaivanban.find(x => x.id === id);
                lvb.code = code; lvb.name = name; lvb.symbol = symbol; lvb.digits = digits; lvb.nextNumber = nextNumber; lvb.disabled = disabled;
                logActivity('action', 'Loại văn bản', 'Cập nhật', `${code} - ${name}`);
            }
            saveToLocalStorage(); closeModal('modal-loai-van-ban'); renderLoaiVanBanTable();
        }

        function deleteLoaiVanBan(id) {
            if(confirm("Bạn có chắc chắn muốn xóa loại văn bản này?")) {
                const lvb = appData.loaivanban.find(x => x.id === id);
                appData.loaivanban = appData.loaivanban.filter(x => x.id !== id);
                logActivity('action', 'Loại văn bản', 'Xóa', lvb ? `${lvb.code} - ${lvb.name}` : id);
                saveToLocalStorage(); renderLoaiVanBanTable();
            }
        }

        /* ================= QUẢN LÝ VĂN BẢN (SUB-MENU CỦA HÀNH CHÍNH NHÂN SỰ) =================
           Mã văn bản tự phát sinh theo ĐÚNG bộ đếm riêng của Loại văn bản đã chọn (chia sẻ cùng cơ chế
           "0000/Năm/Ký hiệu" đã cấu hình ở Danh sách loại văn bản) - CHỈ xem trước khi mở form, bộ đếm
           thật sự chỉ tăng lúc lưu thành công (xem saveVanBanSafely), tránh lãng phí số nếu hủy form. */
        // CHỈ XEM TRƯỚC mã văn bản tiếp theo - KHÔNG tăng bộ đếm, KHÔNG ghi vào file. Bộ đếm THẬT SỰ chỉ
        // tăng khi LƯU THÀNH CÔNG (xem saveVanBanSafely), tránh "nhảy cóc" số nếu mở form rồi hủy.
        async function previewVanBanCode(loaiVanBanId) {
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return '';
            const lvb = fresh.loaivanban.find(x => x.id === loaiVanBanId);
            if (!lvb) return '';
            return buildLoaiVanBanPreview(lvb.digits, lvb.nextNumber, lvb.symbol);
        }

        // Trả về danh sách văn bản ĐANG được lọc hiện tại (theo tìm kiếm + bộ lọc nâng cao) - dùng chung
        // cho cả việc hiển thị bảng lẫn xuất Excel, đảm bảo xuất ĐÚNG những gì đang xem trên màn hình
        function getVanBanFilteredList() {
            let filtered = appData.vanban.filter(x =>
                (x.code || '').toLowerCase().includes(currentSearchQuery) || (x.trichyeu || '').toLowerCase().includes(currentSearchQuery)
            );
            if (advancedVanBanFilter) {
                const { code, loaiVanBanId, nhomCap1Id, nhomCap2Id, nhomCap3Id, matraloidoc, sovanbangoc, nguoiky, dateFrom, dateTo, daphathanhOnly } = advancedVanBanFilter;
                filtered = filtered.filter(x => {
                    if (code && !(x.code || '').toLowerCase().includes(code)) return false;
                    if (loaiVanBanId && x.loaiVanBanId !== loaiVanBanId) return false;
                    // Lọc theo nhóm loại văn bản: chỉ so khớp CHÍNH XÁC cấp nào người dùng đã chọn. Vì văn bản
                    // luôn lưu đủ nhomCap1Id (là tổ tiên của nhomCap2Id/nhomCap3Id nếu có), nên chỉ chọn cấp 1
                    // vẫn tự động bao gồm mọi văn bản thuộc các nhánh con cấp 2/3 bên dưới nó.
                    if (nhomCap1Id && x.nhomCap1Id !== nhomCap1Id) return false;
                    if (nhomCap2Id && x.nhomCap2Id !== nhomCap2Id) return false;
                    if (nhomCap3Id && x.nhomCap3Id !== nhomCap3Id) return false;
                    if (matraloidoc && !(x.matraloidoc || '').toLowerCase().includes(matraloidoc)) return false;
                    if (sovanbangoc && !(x.sovanbangoc || '').toLowerCase().includes(sovanbangoc)) return false;
                    if (nguoiky && !(x.nguoiky || '').toLowerCase().includes(nguoiky)) return false;
                    if (daphathanhOnly && !x.daphathanh) return false;
                    const d = x.ngaybanhanh || '';
                    if (dateFrom && (!d || d < dateFrom)) return false;
                    if (dateTo && (!d || d > dateTo)) return false;
                    return true;
                });
            }
            // Sắp xếp VĂN BẢN MỚI NHẤT (createdAt - thời điểm tạo trong hệ thống) lên ĐẦU danh sách, thay vì
            // để nguyên thứ tự cũ (vốn trùng với thứ tự mã do văn bản được thêm tuần tự theo mã tăng dần).
            // Dùng .slice() để không làm thay đổi thứ tự gốc của mảng appData.vanban (tránh ảnh hưởng tới
            // các chỗ khác đang findIndex/thao tác trực tiếp trên mảng gốc). Văn bản CŨ chưa từng có trường
            // createdAt (tạo trước khi có tính năng này) coi như "cũ nhất", giữ nguyên thứ tự tương đối với
            // nhau (sort ổn định) - không tự bịa ngày tạo giả cho các văn bản này.
            filtered = filtered.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
            return filtered;
        }

        function renderVanBanTable() {
            const body = document.getElementById("body-van-ban");
            const filtered = getVanBanFilteredList();

            // CHẾ ĐỘ LỌC NÂNG CAO: hiện dải thông báo nếu đang áp dụng bộ lọc
            const banner = document.getElementById("vb-filter-active-banner");
            if (advancedVanBanFilter) {
                const { code, nhomCap1Id, nhomCap2Id, nhomCap3Id, matraloidoc, sovanbangoc, nguoiky, dateFrom, dateTo, loaiVanBanId, daphathanhOnly } = advancedVanBanFilter;
                const parts = [];
                if (code) parts.push(`Mã: "${code}"`);
                if (loaiVanBanId) { const lvbF = appData.loaivanban.find(l => l.id === loaiVanBanId); parts.push(`Loại văn bản: "${lvbF ? lvbF.name : ''}"`); }
                if (nhomCap1Id) {
                    const n1 = appData.nhomloaivanban.find(x => x.id === nhomCap1Id)?.name || '';
                    const n2 = nhomCap2Id ? appData.nhomloaivanban.find(x => x.id === nhomCap2Id)?.name : null;
                    const n3 = nhomCap3Id ? appData.nhomloaivanban.find(x => x.id === nhomCap3Id)?.name : null;
                    parts.push(`Nhóm loại văn bản: "${[n1, n2, n3].filter(Boolean).join(' > ')}"`);
                }
                if (matraloidoc) parts.push(`Trả lời VB số: "${matraloidoc}"`);
                if (sovanbangoc) parts.push(`Số văn bản gốc: "${sovanbangoc}"`);
                if (nguoiky) parts.push(`Người ký: "${nguoiky}"`);
                if (daphathanhOnly) parts.push(`Chỉ văn bản đã phát hành`);
                if (dateFrom || dateTo) parts.push(`Ngày ban hành: ${dateFrom ? formatDateVN(dateFrom) : '...'} - ${dateTo ? formatDateVN(dateTo) : '...'}`);
                document.getElementById("vb-filter-active-text").innerText = `🔍 Đang lọc theo: ${parts.join(' | ')} (${filtered.length} kết quả)`;
                banner.style.display = "flex";
            } else {
                banner.style.display = "none";
            }

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-vb").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">${advancedVanBanFilter ? 'Không tìm thấy văn bản nào khớp với bộ lọc nâng cao.' : 'Chưa có văn bản nào được tạo.'}</div>`;
                return;
            }
            document.getElementById("page-bar-vb").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-vb").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} văn bản`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => {
                const lvb = appData.loaivanban.find(l => l.id === x.loaiVanBanId);
                const khoaPhong = x.khoaPhongId ? appData.phongban.find(p => p.id === x.khoaPhongId) : null;
                const emptyDash = '<span style="color:#ccc;">—</span>';
                return `
                    <tr>
                        <td class="col-nowrap"><strong>${escapeHtml(x.code || '')}</strong></td>
                        <td style="max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(lvb ? lvb.name : '')}">${lvb ? escapeHtml(lvb.name) : '<span style="color:#ccc; font-style:italic">Không xác định</span>'}</td>
                        <td style="max-width:280px; color:var(--gray-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(x.trichyeu || '')}">${x.trichyeu ? escapeHtml(x.trichyeu) : emptyDash}</td>
                        <td class="col-nowrap">${x.ngaybanhanh ? formatDateVN(x.ngaybanhanh) : emptyDash}</td>
                        <td style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(khoaPhong ? khoaPhong.name : '')}">${khoaPhong ? escapeHtml(khoaPhong.name) : emptyDash}</td>
                        <td style="max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(x.matraloidoc || '')}">${x.matraloidoc ? escapeHtml(x.matraloidoc) : emptyDash}</td>
                        <td style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(x.phathanhden || '')}">${x.daphathanh ? (x.phathanhden ? escapeHtml(x.phathanhden) : '<span style="color:#ccc; font-style:italic">Chưa rõ đơn vị</span>') : emptyDash}</td>
                        <td style="text-align:center;">
                            <div class="table-actions">
                                <div class="action-dropdown">
                                    <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                    <div class="action-dropdown-menu">
                                        <button type="button" onclick="openVanBanModal('edit', '${x.id}')">✏️ Sửa</button>
                                        <button type="button" onclick="openVanBanDetailModal('${x.id}')">👁️ Xem chi tiết</button>
                                        ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteVanBan('${x.id}')">🗑️ Xóa</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            renderPaginationButtons(document.getElementById("btn-vb"), totalPages);
        }

        async function openVanBanModal(mode, id = null) {
            document.getElementById("edit-vb-code-regen-for").value = "";
            // Danh sách Loại văn bản còn hoạt động (bỏ loại đã vô hiệu hóa, trừ khi đang sửa 1 văn bản đã dùng loại đó)
            const loaiSelect = document.getElementById("vb-loai");
            const activeTypes = appData.loaivanban.filter(x => !x.disabled);
            loaiSelect.innerHTML = activeTypes.map(x => `<option value="${x.id}">${escapeHtml(x.name)} (${escapeHtml(x.symbol)})</option>`).join('')
                || `<option value="">-- Chưa cấu hình loại văn bản nào --</option>`;

            // Danh sách Nhóm loại văn bản CẤP 1 còn hoạt động - cấp 2, cấp 3 sẽ tự lọc/tự ẩn hiện theo lựa chọn
            const nhom1Select = document.getElementById("vb-nhom-1");
            const activeLevel1Groups = appData.nhomloaivanban.filter(x => !x.parentId && !x.disabled);
            nhom1Select.innerHTML = `<option value="">-- Không chọn --</option>` +
                activeLevel1Groups.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');

            // Danh sách Khoa phòng - load từ Danh sách phòng ban (bỏ phòng ban đã vô hiệu hóa, trừ khi đang
            // sửa 1 văn bản đã dùng đúng phòng ban đó)
            const khoaPhongSelect = document.getElementById("vb-khoaphong");
            const activePhongBanList = appData.phongban.filter(x => !x.disabled);
            khoaPhongSelect.innerHTML = `<option value="">-- Không chọn --</option>` +
                activePhongBanList.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');

            if (mode === 'add') {
                document.getElementById("title-modal-vb").innerText = "Cấp Số Văn Bản Mới";
                document.getElementById("edit-vb-id").value = "";
                document.getElementById("edit-vb-version").value = "";
                document.getElementById("vb-code").value = "";
                document.getElementById("vb-trichyeu").value = "";
                document.getElementById("vb-ngaybanhanh").value = "";
                document.getElementById("vb-nguoiky").value = "";
                document.getElementById("vb-khoaphong").value = "";
                document.getElementById("vb-phienban").value = "";
                document.getElementById("vb-matraloidoc").value = "";
                document.getElementById("vb-sovanbangoc").value = "";
                document.getElementById("vb-ghichu").value = "";
                document.getElementById("vb-duongdan").value = "";
                document.getElementById("vb-daphathanh").checked = false;
                document.getElementById("vb-phathanhden").value = "";
                nhom1Select.value = "";
                onVanBanNhomLevelChange(1);
                toggleVanBanPhatHanhField();
                document.getElementById("modal-van-ban").style.display = "flex";
                // Tự động chọn sẵn loại văn bản đầu tiên và phát sinh mã ngay, đỡ phải bấm thêm 1 bước
                if (activeTypes.length > 0) {
                    loaiSelect.value = activeTypes[0].id;
                    await onVanBanLoaiChange();
                }
            } else {
                document.getElementById("title-modal-vb").innerText = "Cập Nhật Văn Bản";
                const vb = appData.vanban.find(x => x.id === id);
                document.getElementById("edit-vb-id").value = vb.id;
                document.getElementById("edit-vb-version").value = vb._v || 1;

                if (vb.loaiVanBanId && !activeTypes.some(x => x.id === vb.loaiVanBanId)) {
                    const typeOutside = appData.loaivanban.find(x => x.id === vb.loaiVanBanId);
                    if (typeOutside) {
                        loaiSelect.innerHTML += `<option value="${typeOutside.id}">${escapeHtml(typeOutside.name)} (Đã vô hiệu hóa)</option>`;
                    }
                }
                loaiSelect.value = vb.loaiVanBanId || "";
                document.getElementById("vb-code").value = vb.code || "";
                document.getElementById("vb-trichyeu").value = vb.trichyeu || "";
                document.getElementById("vb-ngaybanhanh").value = vb.ngaybanhanh || "";
                document.getElementById("vb-nguoiky").value = vb.nguoiky || "";
                if (vb.khoaPhongId && !activePhongBanList.some(x => x.id === vb.khoaPhongId)) {
                    const pbOutside = appData.phongban.find(x => x.id === vb.khoaPhongId);
                    if (pbOutside) khoaPhongSelect.innerHTML += `<option value="${pbOutside.id}">${escapeHtml(pbOutside.name)} (Đã vô hiệu hóa)</option>`;
                }
                khoaPhongSelect.value = vb.khoaPhongId || "";
                document.getElementById("vb-phienban").value = vb.phienban || "";
                document.getElementById("vb-matraloidoc").value = vb.matraloidoc || "";
                document.getElementById("vb-sovanbangoc").value = vb.sovanbangoc || "";
                document.getElementById("vb-ghichu").value = vb.ghichu || "";
                document.getElementById("vb-duongdan").value = vb.duongdan || "";
                document.getElementById("vb-daphathanh").checked = vb.daphathanh || false;
                document.getElementById("vb-phathanhden").value = vb.phathanhden || "";

                // Khôi phục lại đúng nhóm cấp 1/2/3 đã chọn trước đó (thêm lại vào select nếu đã bị vô hiệu hóa)
                if (vb.nhomCap1Id && !activeLevel1Groups.some(x => x.id === vb.nhomCap1Id)) {
                    const outside = appData.nhomloaivanban.find(x => x.id === vb.nhomCap1Id);
                    if (outside) nhom1Select.innerHTML += `<option value="${outside.id}">${escapeHtml(outside.name)} (Đã vô hiệu hóa)</option>`;
                }
                nhom1Select.value = vb.nhomCap1Id || "";
                onVanBanNhomLevelChange(1);

                if (vb.nhomCap2Id) {
                    const sel2 = document.getElementById("vb-nhom-2");
                    if (!Array.from(sel2.options).some(o => o.value === vb.nhomCap2Id)) {
                        const outside = appData.nhomloaivanban.find(x => x.id === vb.nhomCap2Id);
                        if (outside) sel2.innerHTML += `<option value="${outside.id}">${escapeHtml(outside.name)} (Đã vô hiệu hóa)</option>`;
                    }
                    sel2.value = vb.nhomCap2Id;
                    document.getElementById("vb-nhom-2-wrap").style.display = "block";
                    onVanBanNhomLevelChange(2);
                }

                if (vb.nhomCap3Id) {
                    const sel3 = document.getElementById("vb-nhom-3");
                    if (!Array.from(sel3.options).some(o => o.value === vb.nhomCap3Id)) {
                        const outside = appData.nhomloaivanban.find(x => x.id === vb.nhomCap3Id);
                        if (outside) sel3.innerHTML += `<option value="${outside.id}">${escapeHtml(outside.name)} (Đã vô hiệu hóa)</option>`;
                    }
                    sel3.value = vb.nhomCap3Id;
                    document.getElementById("vb-nhom-3-wrap").style.display = "block";
                }

                toggleVanBanPhatHanhField();
                document.getElementById("modal-van-ban").style.display = "flex";
            }
        }

        // Khi chọn Nhóm loại văn bản ở cấp 1 hoặc cấp 2, tự động liệt kê danh sách nhóm CON trực thuộc ở
        // cấp tiếp theo - CHỈ hiển thị trường chọn của cấp tiếp theo nếu nhóm vừa chọn THỰC SỰ có nhóm con
        // (đúng yêu cầu: nếu là null/không có dữ liệu thì ẩn hẳn trường đó đi, không hiển thị select rỗng)
        function onVanBanNhomLevelChange(changedLevel) {
            if (changedLevel === 1) {
                const level1Id = document.getElementById("vb-nhom-1").value;
                const wrap2 = document.getElementById("vb-nhom-2-wrap");
                const wrap3 = document.getElementById("vb-nhom-3-wrap");
                // Đổi cấp 1 -> luôn phải reset lại cấp 3 (vì cấp 2 sắp được tính lại từ đầu)
                wrap3.style.display = "none";
                document.getElementById("vb-nhom-3").innerHTML = "";

                if (!level1Id) {
                    wrap2.style.display = "none";
                    document.getElementById("vb-nhom-2").innerHTML = "";
                    return;
                }
                const children = appData.nhomloaivanban.filter(x => x.parentId === level1Id && !x.disabled);
                if (children.length === 0) {
                    wrap2.style.display = "none";
                    document.getElementById("vb-nhom-2").innerHTML = "";
                } else {
                    wrap2.style.display = "block";
                    const sel2 = document.getElementById("vb-nhom-2");
                    sel2.innerHTML = `<option value="">-- Không chọn --</option>` +
                        children.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
                }
            } else if (changedLevel === 2) {
                const level2Id = document.getElementById("vb-nhom-2").value;
                const wrap3 = document.getElementById("vb-nhom-3-wrap");
                if (!level2Id) {
                    wrap3.style.display = "none";
                    document.getElementById("vb-nhom-3").innerHTML = "";
                    return;
                }
                const children = appData.nhomloaivanban.filter(x => x.parentId === level2Id && !x.disabled);
                if (children.length === 0) {
                    wrap3.style.display = "none";
                    document.getElementById("vb-nhom-3").innerHTML = "";
                } else {
                    wrap3.style.display = "block";
                    const sel3 = document.getElementById("vb-nhom-3");
                    sel3.innerHTML = `<option value="">-- Không chọn --</option>` +
                        children.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
                }
            }
        }

        // Phiên bản dành riêng cho MODAL LỌC NÂNG CAO của "Nhóm loại văn bản" - logic cascading giống hệt
        // onVanBanNhomLevelChange() ở form Thêm/Sửa văn bản, chỉ khác các id phần tử (có tiền tố filter-vb-).
        // Tách riêng thay vì dùng chung hàm để không ảnh hưởng tới form Thêm/Sửa đang hoạt động ổn định.
        function onVanBanFilterNhomLevelChange(changedLevel) {
            if (changedLevel === 1) {
                const level1Id = document.getElementById("filter-vb-nhom-1").value;
                const wrap2 = document.getElementById("filter-vb-nhom-2-wrap");
                const wrap3 = document.getElementById("filter-vb-nhom-3-wrap");
                wrap3.style.display = "none";
                document.getElementById("filter-vb-nhom-3").innerHTML = "";

                if (!level1Id) {
                    wrap2.style.display = "none";
                    document.getElementById("filter-vb-nhom-2").innerHTML = "";
                    return;
                }
                const children = appData.nhomloaivanban.filter(x => x.parentId === level1Id && !x.disabled);
                if (children.length === 0) {
                    wrap2.style.display = "none";
                    document.getElementById("filter-vb-nhom-2").innerHTML = "";
                } else {
                    wrap2.style.display = "block";
                    const sel2 = document.getElementById("filter-vb-nhom-2");
                    sel2.innerHTML = `<option value="">-- Tất cả --</option>` +
                        children.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
                }
            } else if (changedLevel === 2) {
                const level2Id = document.getElementById("filter-vb-nhom-2").value;
                const wrap3 = document.getElementById("filter-vb-nhom-3-wrap");
                if (!level2Id) {
                    wrap3.style.display = "none";
                    document.getElementById("filter-vb-nhom-3").innerHTML = "";
                    return;
                }
                const children = appData.nhomloaivanban.filter(x => x.parentId === level2Id && !x.disabled);
                if (children.length === 0) {
                    wrap3.style.display = "none";
                    document.getElementById("filter-vb-nhom-3").innerHTML = "";
                } else {
                    wrap3.style.display = "block";
                    const sel3 = document.getElementById("filter-vb-nhom-3");
                    sel3.innerHTML = `<option value="">-- Tất cả --</option>` +
                        children.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');
                }
            }
        }


        // Hiện/ẩn trường "Phát hành đến đơn vị" và "Mã văn bản trả lời" theo trạng thái checkbox "Đã phát hành"
        // (Mã văn bản trả lời chỉ có ý nghĩa với văn bản ĐÃ PHÁT HÀNH, nên gộp chung điều kiện hiển thị)
        function toggleVanBanPhatHanhField() {
            const checked = document.getElementById("vb-daphathanh").checked;
            document.getElementById("vb-phathanh-field-wrap").style.display = checked ? "block" : "none";
            document.getElementById("vb-matraloidoc-field-wrap").style.display = checked ? "block" : "none";
        }

        // Chỉ tự phát sinh lại mã khi đang THÊM MỚI (sửa văn bản đã có thì giữ nguyên mã cũ, không đổi số)
        async function onVanBanLoaiChange() {
            const editingId = document.getElementById("edit-vb-id").value;
            const loaiVanBanId = document.getElementById("vb-loai").value;
            const regenField = document.getElementById("edit-vb-code-regen-for");

            if (!editingId) {
                // Chế độ THÊM MỚI: giữ nguyên hành vi cũ - tự động tạo mã ngay khi đổi loại văn bản
                if (!loaiVanBanId) { document.getElementById("vb-code").value = ""; return; }
                document.getElementById("vb-code").value = "Đang tạo mã...";
                const code = await previewVanBanCode(loaiVanBanId);
                document.getElementById("vb-code").value = code || "Lỗi tạo mã - vui lòng thử lại";
                return;
            }

            // Chế độ SỬA: Mã văn bản này có thể đã được cấp/sử dụng chính thức từ trước - KHÔNG được âm
            // thầm ghi đè, phải hỏi rõ người dùng có muốn tạo lại mã cho khớp với loại vừa đổi hay không.
            // (Đây chính là lỗi đã phát hiện: trước đây hàm này bỏ qua hoàn toàn khi đang sửa, khiến đổi
            // Loại văn bản không hề cập nhật lại Mã văn bản, dù lịch sử vẫn ghi nhận đã đổi loại.)
            if (!loaiVanBanId) return;
            const wantRegenerate = confirm(
                "Bạn vừa đổi Loại văn bản.\n\n" +
                "Mã văn bản hiện tại có thể không còn khớp với loại mới. Bấm OK để hệ thống TỰ ĐỘNG TẠO LẠI Mã văn bản theo đúng loại vừa chọn (khuyến nghị), hoặc Cancel để tự nhập/giữ nguyên mã hiện tại."
            );
            if (!wantRegenerate) { regenField.value = ""; return; }

            document.getElementById("vb-code").value = "Đang tạo mã...";
            const code = await previewVanBanCode(loaiVanBanId);
            document.getElementById("vb-code").value = code || "Lỗi tạo mã - vui lòng thử lại";
            regenField.value = loaiVanBanId; // Đánh dấu: cần tăng đúng bộ đếm của loại này khi lưu thành công
        }

        function computeVanBanChanges(oldRec, newRec) {
            const changes = [];
            if ((oldRec.loaiVanBanId || '') !== (newRec.loaiVanBanId || '')) {
                const oldName = appData.loaivanban.find(l => l.id === oldRec.loaiVanBanId)?.name || '(chưa xác định)';
                const newName = appData.loaivanban.find(l => l.id === newRec.loaiVanBanId)?.name || '(chưa xác định)';
                changes.push(`Loại văn bản: "${oldName}" → "${newName}"`);
            }
            if ((oldRec.nhomCap1Id || '') !== (newRec.nhomCap1Id || '') || (oldRec.nhomCap2Id || '') !== (newRec.nhomCap2Id || '') || (oldRec.nhomCap3Id || '') !== (newRec.nhomCap3Id || '')) {
                const fmt = (id1, id2, id3) => {
                    const n1 = appData.nhomloaivanban.find(x => x.id === id1)?.name;
                    const n2 = appData.nhomloaivanban.find(x => x.id === id2)?.name;
                    const n3 = appData.nhomloaivanban.find(x => x.id === id3)?.name;
                    if (!n1) return '(chưa chọn)';
                    return [n1, n2, n3].filter(Boolean).join(' > ');
                };
                changes.push(`Nhóm loại văn bản: "${fmt(oldRec.nhomCap1Id, oldRec.nhomCap2Id, oldRec.nhomCap3Id)}" → "${fmt(newRec.nhomCap1Id, newRec.nhomCap2Id, newRec.nhomCap3Id)}"`);
            }
            if ((oldRec.code || '') !== (newRec.code || '')) {
                changes.push(`Mã văn bản: "${oldRec.code || '(trống)'}" → "${newRec.code || '(trống)'}"`);
            }
            if ((oldRec.trichyeu || '') !== (newRec.trichyeu || '')) {
                changes.push(`Trích yếu: "${oldRec.trichyeu || '(trống)'}" → "${newRec.trichyeu || '(trống)'}"`);
            }
            if ((oldRec.ngaybanhanh || '') !== (newRec.ngaybanhanh || '')) {
                changes.push(`Ngày ban hành: "${oldRec.ngaybanhanh || '(trống)'}" → "${newRec.ngaybanhanh || '(trống)'}"`);
            }
            if ((oldRec.nguoiky || '') !== (newRec.nguoiky || '')) {
                changes.push(`Người ký / Đơn vị soạn thảo: "${oldRec.nguoiky || '(trống)'}" → "${newRec.nguoiky || '(trống)'}"`);
            }
            if ((oldRec.khoaPhongId || '') !== (newRec.khoaPhongId || '')) {
                const oldName = appData.phongban.find(p => p.id === oldRec.khoaPhongId)?.name || '(chưa chọn)';
                const newName = appData.phongban.find(p => p.id === newRec.khoaPhongId)?.name || '(chưa chọn)';
                changes.push(`Khoa phòng: "${oldName}" → "${newName}"`);
            }
            if ((oldRec.phienban || '') !== (newRec.phienban || '')) {
                changes.push(`Phiên bản: "${oldRec.phienban || '(trống)'}" → "${newRec.phienban || '(trống)'}"`);
            }
            if ((oldRec.matraloidoc || '') !== (newRec.matraloidoc || '')) {
                changes.push(`Mã văn bản trả lời: "${oldRec.matraloidoc || '(trống)'}" → "${newRec.matraloidoc || '(trống)'}"`);
            }
            if ((oldRec.sovanbangoc || '') !== (newRec.sovanbangoc || '')) {
                changes.push(`Số văn bản gốc: "${oldRec.sovanbangoc || '(trống)'}" → "${newRec.sovanbangoc || '(trống)'}"`);
            }
            if ((oldRec.ghichu || '') !== (newRec.ghichu || '')) {
                changes.push(`Ghi chú: "${oldRec.ghichu || '(trống)'}" → "${newRec.ghichu || '(trống)'}"`);
            }
            if ((oldRec.duongdan || '') !== (newRec.duongdan || '')) {
                changes.push(`Đường dẫn lưu file: "${oldRec.duongdan || '(trống)'}" → "${newRec.duongdan || '(trống)'}"`);
            }
            if (!!oldRec.daphathanh !== !!newRec.daphathanh) {
                changes.push(`Đã phát hành: "${oldRec.daphathanh ? 'Có' : 'Không'}" → "${newRec.daphathanh ? 'Có' : 'Không'}"`);
            }
            if ((oldRec.phathanhden || '') !== (newRec.phathanhden || '')) {
                changes.push(`Phát hành đến đơn vị: "${oldRec.phathanhden || '(trống)'}" → "${newRec.phathanhden || '(trống)'}"`);
            }
            return changes;
        }

        async function saveVanBan() {
            const id = document.getElementById("edit-vb-id").value;
            const loaiVanBanId = document.getElementById("vb-loai").value;
            const code = document.getElementById("vb-code").value.trim();
            const trichyeu = document.getElementById("vb-trichyeu").value.trim();
            const ngaybanhanh = document.getElementById("vb-ngaybanhanh").value;
            const nguoiky = document.getElementById("vb-nguoiky").value.trim();
            const khoaPhongId = document.getElementById("vb-khoaphong").value || null;
            const phienban = document.getElementById("vb-phienban").value.trim();
            const sovanbangoc = document.getElementById("vb-sovanbangoc").value.trim();
            const ghichu = document.getElementById("vb-ghichu").value.trim();
            const duongdan = document.getElementById("vb-duongdan").value.trim();
            const daphathanh = document.getElementById("vb-daphathanh").checked;
            // Mã văn bản trả lời chỉ hiển thị/có ý nghĩa khi ĐÃ PHÁT HÀNH - nếu chưa tick, ép về rỗng để
            // không vô tình lưu lại giá trị cũ còn sót trong ô đang bị ẩn (giống hệt cách xử lý phathanhden).
            const matraloidoc = daphathanh ? document.getElementById("vb-matraloidoc").value.trim() : '';
            const phathanhden = daphathanh ? document.getElementById("vb-phathanhden").value.trim() : '';
            const nhomCap1Id = document.getElementById("vb-nhom-1").value || null;
            const nhomCap2Id = document.getElementById("vb-nhom-2").value || null;
            const nhomCap3Id = document.getElementById("vb-nhom-3").value || null;
            const baseVersion = parseInt(document.getElementById("edit-vb-version").value || "1", 10);
            const codeRegenForLoaiId = document.getElementById("edit-vb-code-regen-for").value || null;

            if (!loaiVanBanId) return alert("Vui lòng chọn Loại văn bản!");
            if (!code) return alert("Vui lòng điền Mã văn bản!");
            if (!trichyeu) return alert("Vui lòng điền Trích yếu!");

            const btn = document.getElementById("btn-save-vb");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                if (!id) {
                    // createdAt: thời điểm văn bản được TẠO trong hệ thống (không phải Ngày ban hành do người
                    // dùng tự nhập) - dùng riêng để sắp xếp danh sách theo "văn bản mới nhất lên đầu".
                    const newRecord = { id: generateUniqueId("vb"), loaiVanBanId, code, trichyeu, ngaybanhanh, nguoiky, khoaPhongId, phienban, matraloidoc, sovanbangoc, ghichu, duongdan, daphathanh, phathanhden, nhomCap1Id, nhomCap2Id, nhomCap3Id, history: [], createdAt: new Date().toISOString() };
                    await saveVanBanSafely(newRecord, 'add', null);
                } else {
                    const updatedRecord = { id, loaiVanBanId, code, trichyeu, ngaybanhanh, nguoiky, khoaPhongId, phienban, matraloidoc, sovanbangoc, ghichu, duongdan, daphathanh, phathanhden, nhomCap1Id, nhomCap2Id, nhomCap3Id };
                    await saveVanBanSafely(updatedRecord, 'edit', baseVersion, codeRegenForLoaiId);
                }
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Văn Bản"; }
            }
        }

        async function deleteVanBan(id) {
            if (!confirm("Bạn có chắc chắn muốn xóa văn bản này?")) return;
            const record = appData.vanban.find(x => x.id === id);
            const baseVersion = record ? (record._v || 1) : 1;
            await saveVanBanSafely({ id }, 'delete', baseVersion);
        }

        /* Cơ chế chống xung đột dữ liệu (Optimistic Concurrency Control) - đồng thời ghi lại LỊCH SỬ CẬP NHẬT
           mỗi khi sửa (so sánh dữ liệu cũ với dữ liệu mới, lưu vào record.history để xem lại ở Xem chi tiết) */
        async function saveVanBanSafely(record, mode, baseVersion, codeRegenForLoaiId = null) {
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return;

            if (mode === 'add') {
                record._v = 1;
                fresh.vanban.push(record);
                logActivity('action', 'Quản lý văn bản', 'Cấp số văn bản mới', record.code, fresh);
                // Chỉ THỰC SỰ tăng bộ đếm của ĐÚNG loại văn bản đã chọn khi lưu thành công, tránh lãng phí
                // số nếu người dùng mở form rồi hủy mà không lưu gì.
                const lvb = fresh.loaivanban.find(x => x.id === record.loaiVanBanId);
                if (lvb) lvb.nextNumber = (lvb.nextNumber || 1) + 1;
            } else if (mode === 'delete') {
                const idx = fresh.vanban.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    alert("Văn bản này đã được người khác xóa trước đó rồi, không cần thao tác gì thêm.");
                } else {
                    if ((fresh.vanban[idx]._v || 1) !== (baseVersion || 1)) {
                        const forceDelete = confirm("⚠️ Văn bản này vừa được người khác cập nhật trong lúc bạn thao tác.\n\nBấm OK để VẪN XÓA, hoặc Cancel để hủy và xem dữ liệu mới nhất.");
                        if (!forceDelete) { await persistAppDataSnapshot(fresh); renderVanBanTable(); return; }
                    }
                    logActivity('action', 'Quản lý văn bản', 'Xóa', fresh.vanban[idx].code, fresh);
                    fresh.vanban.splice(idx, 1);
                }
            } else { // edit
                const idx = fresh.vanban.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    const keepMine = confirm("⚠️ Văn bản này đã bị người khác xóa trong lúc bạn đang chỉnh sửa.\n\nBấm OK để LƯU LẠI thông tin của bạn thành một văn bản mới, hoặc Cancel để hủy thao tác.");
                    if (!keepMine) { await persistAppDataSnapshot(fresh); closeModal('modal-van-ban'); renderVanBanTable(); return; }
                    record._v = 1;
                    record.history = [];
                    // Văn bản gốc đã bị xóa mất, bản ghi này thực chất trở thành MỚI hoàn toàn -> gán createdAt
                    // mới để nó hiển thị đúng vị trí "mới nhất" trên đầu danh sách.
                    record.createdAt = new Date().toISOString();
                    fresh.vanban.push(record);
                } else {
                    const current = fresh.vanban[idx];
                    if ((current._v || 1) !== (baseVersion || 1)) {
                        const overwrite = confirm(
                            "⚠️ Văn bản này vừa được người khác cập nhật trong lúc bạn đang chỉnh sửa!\n\n" +
                            "Dữ liệu mới nhất trên hệ thống:\n" +
                            `- Mã văn bản: ${current.code}\n- Trích yếu: ${current.trichyeu}\n\n` +
                            "Bấm OK để GHI ĐÈ bằng thông tin bạn vừa nhập, hoặc Cancel để HỦY và giữ dữ liệu mới nhất."
                        );
                        if (!overwrite) { await persistAppDataSnapshot(fresh); closeModal('modal-van-ban'); renderVanBanTable(); return; }
                    }
                    // Ghi lại lịch sử cập nhật TRƯỚC khi ghi đè dữ liệu mới
                    const changes = computeVanBanChanges(current, record);
                    if (changes.length > 0) {
                        const identity = getCurrentSessionIdentity();
                        const history = current.history || [];
                        history.push({ id: generateUniqueId("vbh"), datetime: new Date().toISOString(), changedBy: identity.name, changes });
                        record.history = history;
                    } else {
                        record.history = current.history || [];
                    }
                    record._v = (current._v || 1) + 1;
                    // Giữ NGUYÊN thời điểm tạo gốc (createdAt) - chỉ sửa nội dung không được phép làm văn bản
                    // "nhảy" lên đầu danh sách như thể vừa mới tạo. Văn bản cũ trước khi có trường này (chưa
                    // từng có createdAt) vẫn giữ nguyên "chưa có" - không tự bịa ngày tạo giả.
                    record.createdAt = current.createdAt;
                    fresh.vanban[idx] = record;
                    logActivity('action', 'Quản lý văn bản', 'Cập nhật', record.code, fresh);
                    // Nếu Loại văn bản bị đổi khi sửa, và mã CŨ chính xác là số VỪA MỚI NHẤT được cấp cho
                    // loại đó (chưa có văn bản nào khác dùng tới số tiếp theo), TRẢ LẠI số này cho loại cũ
                    // để dùng ở lần cấp tiếp theo - tránh bị "nhảy số" oan uổng khi người dùng chỉ lỡ chọn
                    // nhầm loại văn bản rồi sửa lại ngay (lỗi đã được báo cáo và khắc phục). CHỈ trả lại khi
                    // thực sự AN TOÀN (số cũ === nextNumber-1 của loại đó) - nếu đã có văn bản khác của loại
                    // cũ được cấp số sau đó, KHÔNG được trả lại vì sẽ gây trùng mã với văn bản đó.
                    if (current.loaiVanBanId && current.loaiVanBanId !== record.loaiVanBanId && current.code) {
                        const oldType = fresh.loaivanban.find(x => x.id === current.loaiVanBanId);
                        if (oldType) {
                            const oldCodeNumber = parseInt(current.code.split('/')[0], 10);
                            if (!isNaN(oldCodeNumber) && oldCodeNumber === (oldType.nextNumber || 1) - 1) {
                                oldType.nextNumber = oldCodeNumber;
                            }
                        }
                    }
                    // Nếu người dùng đã đồng ý TẠO LẠI mã theo loại mới lúc sửa (không phải tự gõ tay), phải
                    // tăng đúng bộ đếm của loại đó - giống hệt logic ở chế độ Thêm mới - để tránh việc lần
                    // "Cấp Số Văn Bản Mới" tiếp theo của CHÍNH loại này vô tình sinh ra số bị trùng.
                    if (codeRegenForLoaiId && codeRegenForLoaiId === record.loaiVanBanId) {
                        const lvb = fresh.loaivanban.find(x => x.id === codeRegenForLoaiId);
                        if (lvb) lvb.nextNumber = (lvb.nextNumber || 1) + 1;
                    }
                }
            }

            fresh._rev = (fresh._rev || 0) + 1;
            await persistAppDataSnapshot(fresh);
            closeModal('modal-van-ban');
            renderVanBanTable();
        }

        function openVanBanDetailModal(id) {
            const vb = appData.vanban.find(x => x.id === id);
            if (!vb) { alert("Văn bản này không còn tồn tại (có thể đã bị xóa)."); return; }
            const lvb = appData.loaivanban.find(l => l.id === vb.loaiVanBanId);
            const khoaPhong = vb.khoaPhongId ? appData.phongban.find(p => p.id === vb.khoaPhongId) : null;
            const nhomNames = [vb.nhomCap1Id, vb.nhomCap2Id, vb.nhomCap3Id]
                .map(gid => gid ? appData.nhomloaivanban.find(x => x.id === gid)?.name : null)
                .filter(Boolean);
            const emptyTag = '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>';

            document.getElementById("vb-detail-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Mã văn bản</span><span class="detail-info-value">${escapeHtml(vb.code || '')}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Loại văn bản</span><span class="detail-info-value">${lvb ? escapeHtml(lvb.name) : '<span style="color:#ccc; font-weight:400; font-style:italic">Không xác định</span>'}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Nhóm loại văn bản</span><span class="detail-info-value" style="font-weight:400;">${nhomNames.length > 0 ? escapeHtml(nhomNames.join(' > ')) : emptyTag}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Trích yếu</span><span class="detail-info-value" style="font-weight:400;">${escapeHtml(vb.trichyeu || '')}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Ngày ban hành</span><span class="detail-info-value" style="font-weight:400;">${vb.ngaybanhanh ? formatDateVN(vb.ngaybanhanh) : emptyTag}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Người ký / Đơn vị soạn thảo</span><span class="detail-info-value" style="font-weight:400;">${vb.nguoiky ? escapeHtml(vb.nguoiky) : emptyTag}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Khoa phòng</span><span class="detail-info-value" style="font-weight:400;">${khoaPhong ? escapeHtml(khoaPhong.name) : emptyTag}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Phiên bản</span><span class="detail-info-value" style="font-weight:400;">${vb.phienban ? escapeHtml(vb.phienban) : emptyTag}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Mã văn bản trả lời</span><span class="detail-info-value" style="font-weight:400;">${vb.matraloidoc ? escapeHtml(vb.matraloidoc) : emptyTag}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Số văn bản gốc</span><span class="detail-info-value" style="font-weight:400;">${vb.sovanbangoc ? escapeHtml(vb.sovanbangoc) : emptyTag}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Ghi chú</span><span class="detail-info-value" style="font-weight:400;">${vb.ghichu ? escapeHtml(vb.ghichu) : emptyTag}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Đường dẫn lưu file</span><span class="detail-info-value" style="font-weight:400; font-family:monospace; font-size:12px;">${vb.duongdan ? escapeHtml(vb.duongdan) : emptyTag}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Đã phát hành</span><span class="detail-info-value" style="font-weight:400;">${vb.daphathanh ? '<span class="appointment-status-badge" style="background:#e8f5e9; color:#2e7d32; border-color:#2e7d32;">✅ Đã phát hành</span>' : '<span class="appointment-status-badge" style="background:#fff8e1; color:#a67c00; border-color:#f0d774;">Chưa phát hành</span>'}</span></div>
                ${vb.daphathanh ? `<div class="detail-info-item"><span class="detail-info-label">Phát hành đến đơn vị</span><span class="detail-info-value" style="font-weight:400;">${vb.phathanhden ? escapeHtml(vb.phathanhden) : emptyTag}</span></div>` : ''}
            `;
            renderVbHistory(vb);
            document.getElementById("modal-van-ban-detail").style.display = "flex";
        }

        function switchVbDetailTab(tabName) {
            // Hiện chỉ có 1 tab (Lịch sử cập nhật) - giữ cơ chế chuyển tab để dễ mở rộng thêm tab khác sau này
            document.getElementById("detail-tab-btn-vb-history").classList.add("active");
            document.getElementById("detail-tab-panel-vb-history").classList.add("active");
        }

        function renderVbHistory(vb) {
            const container = document.getElementById("vb-detail-history");
            const history = vb.history || [];
            if (history.length === 0) {
                container.innerHTML = `<div class="detail-log-empty">📭 Chưa có lịch sử cập nhật nào.</div>`;
                return;
            }
            const sorted = [...history].sort((a, b) => b.datetime.localeCompare(a.datetime));
            container.innerHTML = sorted.map(h => `
                <div class="detail-log-item log-type-edit">
                    <div class="detail-log-header">
                        <div class="detail-log-meta">
                            <span class="detail-log-icon">📝</span>
                            <span class="detail-log-author">${escapeHtml(h.changedBy)}</span>
                            <span class="detail-log-dot">•</span>
                            <span>${formatDatetimeVNFull(h.datetime)}</span>
                        </div>
                    </div>
                    <div class="detail-log-changes">${h.changes.map(c => `<span class="change-line">• ${escapeHtml(c)}</span>`).join('')}</div>
                </div>
            `).join('');
        }

        /* ================= QUẢN LÝ CME (SUB-MENU CỦA HÀNH CHÍNH NHÂN SỰ) =================
           Cấu trúc/logic giống hệt Quản Lý Văn Bản: cơ chế đọc-mới-nhất-rồi-ghi (readFreshAppDataSnapshotOrWarn
           + persistAppDataSnapshot), lưu lịch sử cập nhật khi sửa. Điểm khác: có thêm "Quá trình đào tạo" -
           1 danh sách con lồng bên trong mỗi nhân sự CME (1 người có thể có NHIỀU lần đào tạo khác nhau). */
        function renderCmeTable() {
            // Khởi tạo danh sách năm để lọc (chỉ 1 lần) - quanh năm hiện tại, kèm lựa chọn "Tất cả các năm"
            const yearSelect = document.getElementById("cme-filter-year");
            if (yearSelect.options.length === 0) {
                const currentYear = new Date().getFullYear();
                let opts = `<option value="">Tất cả các năm</option>`;
                for (let y = currentYear + 1; y >= currentYear - 5; y--) opts += `<option value="${y}">Năm ${y}</option>`;
                yearSelect.innerHTML = opts;
            }
            const filterYear = yearSelect.value; // "" nghĩa là không lọc, đếm tổng tất cả các năm

            const body = document.getElementById("body-cme");
            const filtered = appData.cme.filter(x =>
                (x.hoten || '').toLowerCase().includes(currentSearchQuery) || (x.sogiayphep || '').toLowerCase().includes(currentSearchQuery)
            );

            document.getElementById("cme-th-daotao").innerText = filterYear ? `Đào Tạo (${filterYear})` : "Đào Tạo";

            if (filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-cme").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có nhân sự CME nào được tạo.</div>`;
                return;
            }
            document.getElementById("page-bar-cme").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-cme").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} nhân sự`;

            const pageData = filtered.slice(startIndex, endIndex);
            const emptyDash = '<span style="color:#ccc;">—</span>';
            body.innerHTML = pageData.map(x => {
                const allTrainings = x.trainings || [];
                // Nếu có chọn năm để lọc, CHỈ đếm những chương trình đào tạo có Thời gian thuộc đúng năm đó
                const trainingCount = filterYear
                    ? allTrainings.filter(t => (t.thoigian || '').startsWith(filterYear)).length
                    : allTrainings.length;
                return `
                    <tr>
                        <td style="font-weight:600; color:var(--dark-brown);"><strong>${escapeHtml(x.hoten || '')}</strong></td>
                        <td style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(x.vitrichuyenmon || '')}">${x.vitrichuyenmon ? escapeHtml(x.vitrichuyenmon) : emptyDash}</td>
                        <td style="max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${x.chucdanh ? escapeHtml(x.chucdanh) : emptyDash}</td>
                        <td class="col-nowrap">${x.sogiayphep ? escapeHtml(x.sogiayphep) : emptyDash}</td>
                        <td class="col-nowrap" style="text-align:center;">${trainingCount > 0 ? `<span class="appointment-status-badge" style="background:#e3f2fd; color:#1565c0; border-color:#1565c0;">${trainingCount} lần</span>` : emptyDash}</td>
                        <td style="text-align:center;">
                            <div class="table-actions">
                                <div class="action-dropdown">
                                    <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                    <div class="action-dropdown-menu">
                                        <button type="button" onclick="openCmeModal('edit', '${x.id}')">✏️ Sửa</button>
                                        <button type="button" onclick="openCmeDetailModal('${x.id}')">👁️ Xem chi tiết</button>
                                        ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteCme('${x.id}')">🗑️ Xóa</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            renderPaginationButtons(document.getElementById("btn-cme"), totalPages);
        }

        function openCmeModal(mode, id = null) {
            if (mode === 'add') {
                document.getElementById("title-modal-cme").innerText = "Thêm Mới CME";
                document.getElementById("edit-cme-id").value = "";
                document.getElementById("edit-cme-version").value = "";
                document.getElementById("cme-hoten").value = "";
                document.getElementById("cme-chucdanh").value = "";
                document.getElementById("cme-vitrichuyenmon").value = "";
                document.getElementById("cme-sogiayphep").value = "";
                document.getElementById("cme-phamvihanhnghe").value = "";
            } else {
                document.getElementById("title-modal-cme").innerText = "Cập Nhật CME";
                const cme = appData.cme.find(x => x.id === id);
                document.getElementById("edit-cme-id").value = cme.id;
                document.getElementById("edit-cme-version").value = cme._v || 1;
                document.getElementById("cme-hoten").value = cme.hoten || "";
                document.getElementById("cme-chucdanh").value = cme.chucdanh || "";
                document.getElementById("cme-vitrichuyenmon").value = cme.vitrichuyenmon || "";
                document.getElementById("cme-sogiayphep").value = cme.sogiayphep || "";
                document.getElementById("cme-phamvihanhnghe").value = cme.phamvihanhnghe || "";
            }
            document.getElementById("modal-cme").style.display = "flex";
        }

        function computeCmeChanges(oldRec, newRec) {
            const changes = [];
            if ((oldRec.hoten || '') !== (newRec.hoten || '')) changes.push(`Họ và tên: "${oldRec.hoten || '(trống)'}" → "${newRec.hoten || '(trống)'}"`);
            if ((oldRec.chucdanh || '') !== (newRec.chucdanh || '')) changes.push(`Chức danh: "${oldRec.chucdanh || '(trống)'}" → "${newRec.chucdanh || '(trống)'}"`);
            if ((oldRec.vitrichuyenmon || '') !== (newRec.vitrichuyenmon || '')) changes.push(`Vị trí chuyên môn: "${oldRec.vitrichuyenmon || '(trống)'}" → "${newRec.vitrichuyenmon || '(trống)'}"`);
            if ((oldRec.sogiayphep || '') !== (newRec.sogiayphep || '')) changes.push(`Số giấy phép / CCHN: "${oldRec.sogiayphep || '(trống)'}" → "${newRec.sogiayphep || '(trống)'}"`);
            if ((oldRec.phamvihanhnghe || '') !== (newRec.phamvihanhnghe || '')) changes.push(`Phạm vi hành nghề: "${oldRec.phamvihanhnghe || '(trống)'}" → "${newRec.phamvihanhnghe || '(trống)'}"`);
            return changes;
        }

        async function saveCme() {
            const id = document.getElementById("edit-cme-id").value;
            const hoten = document.getElementById("cme-hoten").value.trim();
            const chucdanh = document.getElementById("cme-chucdanh").value.trim();
            const vitrichuyenmon = document.getElementById("cme-vitrichuyenmon").value.trim();
            const sogiayphep = document.getElementById("cme-sogiayphep").value.trim();
            const phamvihanhnghe = document.getElementById("cme-phamvihanhnghe").value.trim();
            const baseVersion = parseInt(document.getElementById("edit-cme-version").value || "1", 10);

            if (!hoten) return alert("Vui lòng điền Họ và tên!");

            const btn = document.getElementById("btn-save-cme");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                if (!id) {
                    const newRecord = { id: generateUniqueId("cme"), hoten, chucdanh, vitrichuyenmon, sogiayphep, phamvihanhnghe, trainings: [], history: [] };
                    await saveCmeSafely(newRecord, 'add', null);
                } else {
                    const updatedRecord = { id, hoten, chucdanh, vitrichuyenmon, sogiayphep, phamvihanhnghe };
                    await saveCmeSafely(updatedRecord, 'edit', baseVersion);
                }
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Thông Tin CME"; }
            }
        }

        async function deleteCme(id) {
            if (!confirm("Bạn có chắc chắn muốn xóa nhân sự CME này? (Toàn bộ quá trình đào tạo đã ghi nhận cũng sẽ bị xóa theo)")) return;
            const record = appData.cme.find(x => x.id === id);
            const baseVersion = record ? (record._v || 1) : 1;
            await saveCmeSafely({ id }, 'delete', baseVersion);
        }

        /* Cơ chế chống xung đột dữ liệu (Optimistic Concurrency Control) - giống hệt saveVanBanSafely,
           kèm ghi lại LỊCH SỬ CẬP NHẬT mỗi khi sửa (không đụng tới mảng "trainings" - việc thêm quá trình
           đào tạo có hàm/cơ chế lưu RIÊNG là saveCmeTrainingSafely bên dưới, tránh xung đột giữa 2 luồng). */
        async function saveCmeSafely(record, mode, baseVersion) {
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return;

            if (mode === 'add') {
                record._v = 1;
                fresh.cme.push(record);
                logActivity('action', 'Quản lý CME', 'Thêm mới', record.hoten, fresh);
            } else if (mode === 'delete') {
                const idx = fresh.cme.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    alert("Nhân sự CME này đã được người khác xóa trước đó rồi, không cần thao tác gì thêm.");
                } else {
                    if ((fresh.cme[idx]._v || 1) !== (baseVersion || 1)) {
                        const forceDelete = confirm("⚠️ Thông tin CME này vừa được người khác cập nhật trong lúc bạn thao tác.\n\nBấm OK để VẪN XÓA, hoặc Cancel để hủy và xem dữ liệu mới nhất.");
                        if (!forceDelete) { await persistAppDataSnapshot(fresh); renderCmeTable(); return; }
                    }
                    logActivity('action', 'Quản lý CME', 'Xóa', fresh.cme[idx].hoten, fresh);
                    fresh.cme.splice(idx, 1);
                }
            } else { // edit
                const idx = fresh.cme.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    const keepMine = confirm("⚠️ Nhân sự CME này đã bị người khác xóa trong lúc bạn đang chỉnh sửa.\n\nBấm OK để LƯU LẠI thông tin của bạn thành một bản ghi mới, hoặc Cancel để hủy thao tác.");
                    if (!keepMine) { await persistAppDataSnapshot(fresh); closeModal('modal-cme'); renderCmeTable(); return; }
                    record._v = 1;
                    record.trainings = [];
                    record.history = [];
                    fresh.cme.push(record);
                } else {
                    const current = fresh.cme[idx];
                    if ((current._v || 1) !== (baseVersion || 1)) {
                        const overwrite = confirm(
                            "⚠️ Nhân sự CME này vừa được người khác cập nhật trong lúc bạn đang chỉnh sửa!\n\n" +
                            "Dữ liệu mới nhất trên hệ thống:\n" +
                            `- Họ và tên: ${current.hoten}\n- Chức danh: ${current.chucdanh || '(trống)'}\n\n` +
                            "Bấm OK để GHI ĐÈ bằng thông tin bạn vừa nhập, hoặc Cancel để HỦY và giữ dữ liệu mới nhất."
                        );
                        if (!overwrite) { await persistAppDataSnapshot(fresh); closeModal('modal-cme'); renderCmeTable(); return; }
                    }
                    // Ghi lại lịch sử cập nhật TRƯỚC khi ghi đè dữ liệu mới, đồng thời GIỮ NGUYÊN mảng
                    // trainings/history đã có (record vừa nhận từ form không hề có 2 trường này)
                    const changes = computeCmeChanges(current, record);
                    const history = current.history || [];
                    if (changes.length > 0) {
                        const identity = getCurrentSessionIdentity();
                        history.push({ id: generateUniqueId("cmeh"), datetime: new Date().toISOString(), changedBy: identity.name, changes });
                    }
                    record.history = history;
                    record.trainings = current.trainings || [];
                    record._v = (current._v || 1) + 1;
                    fresh.cme[idx] = record;
                    logActivity('action', 'Quản lý CME', 'Cập nhật', record.hoten, fresh);
                }
            }

            fresh._rev = (fresh._rev || 0) + 1;
            await persistAppDataSnapshot(fresh);
            closeModal('modal-cme');
            renderCmeTable();
        }

        function openCmeDetailModal(id) {
            const cme = appData.cme.find(x => x.id === id);
            if (!cme) { alert("Nhân sự CME này không còn tồn tại (có thể đã bị xóa)."); return; }
            const emptyTag = '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>';

            document.getElementById("cme-detail-id").value = id;
            document.getElementById("cme-detail-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Họ và tên</span><span class="detail-info-value">${escapeHtml(cme.hoten || '')}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Chức danh</span><span class="detail-info-value" style="font-weight:400;">${cme.chucdanh ? escapeHtml(cme.chucdanh) : emptyTag}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Vị trí chuyên môn</span><span class="detail-info-value" style="font-weight:400;">${cme.vitrichuyenmon ? escapeHtml(cme.vitrichuyenmon) : emptyTag}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Số giấy phép / CCHN</span><span class="detail-info-value" style="font-weight:400;">${cme.sogiayphep ? escapeHtml(cme.sogiayphep) : emptyTag}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Phạm vi hành nghề</span><span class="detail-info-value" style="font-weight:400;">${cme.phamvihanhnghe ? escapeHtml(cme.phamvihanhnghe) : emptyTag}</span></div>
            `;
            switchCmeDetailTab('training');
            renderCmeTrainingList(cme);
            renderCmeHistory(cme);
            document.getElementById("modal-cme-detail").style.display = "flex";
        }

        function switchCmeDetailTab(tabName) {
            const isTraining = tabName === 'training';
            document.getElementById("detail-tab-btn-cme-training").classList.toggle("active", isTraining);
            document.getElementById("detail-tab-btn-cme-history").classList.toggle("active", !isTraining);
            document.getElementById("detail-tab-panel-cme-training").classList.toggle("active", isTraining);
            document.getElementById("detail-tab-panel-cme-history").classList.toggle("active", !isTraining);
        }

        // Dựng HTML 1 khung nhỏ gọn cho 1 chương trình đào tạo - dùng chung cho cả danh sách rút gọn (tối đa 4)
        // và popup "Xem danh sách đầy đủ"
        function buildCmeTrainingCardHTML(t) {
            return `
                <div class="cme-training-card">
                    <div class="cme-training-card-top">
                        <span class="cme-training-name" title="${escapeHtml(t.chuongtrinh || '')}">${escapeHtml(t.chuongtrinh || '')}</span>
                        ${t.sotiet ? `<span class="cme-training-badge">${escapeHtml(String(t.sotiet))} tiết</span>` : ''}
                    </div>
                    <div class="cme-training-meta" title="${escapeHtml(t.donvidaotao || '')}">${t.donvidaotao ? '📍 ' + escapeHtml(t.donvidaotao) : '<span style="color:#ccc; font-style:italic">Chưa cập nhật đơn vị</span>'}</div>
                    <div class="cme-training-meta">${t.thoigian ? '🗓️ ' + formatDateVN(t.thoigian) : '<span style="color:#ccc; font-style:italic">Chưa cập nhật thời gian</span>'}</div>
                </div>
            `;
        }

        // Số khung tối đa hiển thị trực tiếp trên tab Quá trình đào tạo trước khi gộp thành nút "Xem danh sách đầy đủ"
        const CME_TRAINING_MAX_VISIBLE = 4;
        let cmeTrainingFullListCache = []; // Lưu tạm để popup "Xem danh sách đầy đủ" dùng lại, không phải đọc lại appData

        function renderCmeTrainingList(cme) {
            const container = document.getElementById("cme-detail-training");
            const viewAllBtn = document.getElementById("btn-cme-training-viewall");
            const trainings = cme.trainings || [];

            // 2 ô thống kê: tổng số chương trình đã học + tổng số tiết cộng dồn
            document.getElementById("cme-detail-training-count").innerText = trainings.length;
            const totalHours = trainings.reduce((sum, t) => sum + (parseFloat(t.sotiet) || 0), 0);
            document.getElementById("cme-detail-training-hours").innerText = totalHours;

            if (trainings.length === 0) {
                container.innerHTML = `<div class="detail-log-empty" style="grid-column: 1 / -1;">📭 Chưa có quá trình đào tạo nào được ghi nhận.</div>`;
                viewAllBtn.style.display = "none";
                return;
            }

            const sorted = [...trainings].sort((a, b) => (b.thoigian || '').localeCompare(a.thoigian || ''));
            cmeTrainingFullListCache = sorted;

            const visible = sorted.slice(0, CME_TRAINING_MAX_VISIBLE);
            container.innerHTML = visible.map(t => buildCmeTrainingCardHTML(t)).join('');

            if (sorted.length > CME_TRAINING_MAX_VISIBLE) {
                viewAllBtn.style.display = "inline-block";
                viewAllBtn.innerText = `Xem danh sách đầy đủ (${sorted.length} chương trình)`;
            } else {
                viewAllBtn.style.display = "none";
            }
        }

        // Mở popup hiển thị TOÀN BỘ chương trình đào tạo (khi có nhiều hơn 4) - tái sử dụng cache vừa dựng
        // ở renderCmeTrainingList(), không cần đọc lại appData
        function openCmeTrainingFullListModal() {
            document.getElementById("title-modal-cme-training-full").innerText = `Toàn Bộ Quá Trình Đào Tạo (${cmeTrainingFullListCache.length} chương trình)`;
            document.getElementById("cme-training-full-list").innerHTML = cmeTrainingFullListCache.map(t => buildCmeTrainingCardHTML(t)).join('');
            document.getElementById("modal-cme-training-full").style.display = "flex";
        }

        function renderCmeHistory(cme) {
            const container = document.getElementById("cme-detail-history");
            const history = cme.history || [];
            if (history.length === 0) {
                container.innerHTML = `<div class="detail-log-empty">📭 Chưa có lịch sử cập nhật nào.</div>`;
                return;
            }
            const sorted = [...history].sort((a, b) => b.datetime.localeCompare(a.datetime));
            container.innerHTML = sorted.map(h => `
                <div class="detail-log-item log-type-edit">
                    <div class="detail-log-header">
                        <div class="detail-log-meta">
                            <span class="detail-log-icon">📝</span>
                            <span class="detail-log-author">${escapeHtml(h.changedBy)}</span>
                            <span class="detail-log-dot">•</span>
                            <span>${formatDatetimeVNFull(h.datetime)}</span>
                        </div>
                    </div>
                    <div class="detail-log-changes">${h.changes.map(c => `<span class="change-line">• ${escapeHtml(c)}</span>`).join('')}</div>
                </div>
            `).join('');
        }

        /* ================= THÊM QUÁ TRÌNH ĐÀO TẠO CHO 1 NHÂN SỰ CME (CÓ THỂ THÊM NHIỀU LẦN) ================= */
        function openCmeTrainingModal() {
            document.getElementById("cme-training-chuongtrinh").value = "";
            document.getElementById("cme-training-donvi").value = "";
            document.getElementById("cme-training-thoigian").value = "";
            document.getElementById("cme-training-sotiet").value = "";
            document.getElementById("modal-cme-training").style.display = "flex";
        }

        async function saveCmeTraining() {
            const cmeId = document.getElementById("cme-detail-id").value;
            const chuongtrinh = document.getElementById("cme-training-chuongtrinh").value.trim();
            const donvidaotao = document.getElementById("cme-training-donvi").value.trim();
            const thoigian = document.getElementById("cme-training-thoigian").value;
            const sotiet = document.getElementById("cme-training-sotiet").value.trim();

            if (!chuongtrinh) return alert("Vui lòng điền Chương trình đào tạo!");

            const btn = document.getElementById("btn-save-cme-training");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                const fresh = await readFreshAppDataSnapshotOrWarn();
                if (!fresh) return;
                const cme = fresh.cme.find(x => x.id === cmeId);
                if (!cme) {
                    alert("Nhân sự CME này không còn tồn tại (có thể đã bị người khác xóa). Vui lòng đóng popup và tải lại danh sách.");
                    await persistAppDataSnapshot(fresh);
                    return;
                }
                if (!cme.trainings) cme.trainings = [];
                cme.trainings.push({ id: generateUniqueId("cmet"), chuongtrinh, donvidaotao, thoigian, sotiet });
                cme._v = (cme._v || 1) + 1;
                logActivity('action', 'Quản lý CME', 'Thêm quá trình đào tạo', `${cme.hoten} - ${chuongtrinh}`, fresh);
                fresh._rev = (fresh._rev || 0) + 1;
                await persistAppDataSnapshot(fresh);

                closeModal('modal-cme-training');
                renderCmeTrainingList(cme);
                renderCmeTable();
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Quá Trình Đào Tạo"; }
            }
        }


        // Khoảng thời gian đang lọc trên Dashboard - null nghĩa là chưa khởi tạo (sẽ tự động về Tháng hiện tại)
        let dashboardFilterRange = null;

        // Khởi tạo danh sách Tháng (1-12) và Năm (quanh năm hiện tại) cho 2 dropdown lọc - chỉ chạy 1 lần
        function initDashboardFilterControls() {
            const monthSelect = document.getElementById("dash-filter-month");
            if (monthSelect.options.length === 0) {
                monthSelect.innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">Tháng ${i + 1}</option>`).join('');
            }
            const yearSelect = document.getElementById("dash-filter-year");
            if (yearSelect.options.length === 0) {
                const currentYear = new Date().getFullYear();
                let opts = '';
                for (let y = currentYear - 5; y <= currentYear + 1; y++) opts += `<option value="${y}">Năm ${y}</option>`;
                yearSelect.innerHTML = opts;
            }
        }

        // Áp dụng bộ lọc: nếu có nhập đủ "Từ ngày" và "Đến ngày" thì ưu tiên dùng khoảng ngày tùy chỉnh đó,
        // ngược lại dùng Tháng + Năm đã chọn (lọc trọn 1 tháng)
        function applyDashboardFilter() {
            const fromInput = document.getElementById("dash-filter-from").value;
            const toInput = document.getElementById("dash-filter-to").value;

            if (fromInput || toInput) {
                if (!fromInput || !toInput) return alert("Vui lòng nhập đủ cả Từ ngày và Đến ngày!");
                if (fromInput > toInput) return alert("Khoảng ngày không hợp lệ: Từ ngày phải trước hoặc bằng Đến ngày!");
                dashboardFilterRange = { from: fromInput, to: toInput, label: `${formatDateVN(fromInput)} - ${formatDateVN(toInput)}` };
            } else {
                const month = parseInt(document.getElementById("dash-filter-month").value, 10);
                const year = parseInt(document.getElementById("dash-filter-year").value, 10);
                const from = `${year}-${pad2(month)}-01`;
                const lastDay = new Date(year, month, 0).getDate();
                const to = `${year}-${pad2(month)}-${pad2(lastDay)}`;
                dashboardFilterRange = { from, to, label: `Tháng ${month}/${year}` };
            }
            renderDashboardLeTan();
        }

        // Đặt lại bộ lọc về mặc định (tháng hiện tại), xóa khoảng ngày tùy chỉnh
        function resetDashboardFilter() {
            const now = new Date();
            document.getElementById("dash-filter-month").value = now.getMonth() + 1;
            document.getElementById("dash-filter-year").value = now.getFullYear();
            document.getElementById("dash-filter-from").value = "";
            document.getElementById("dash-filter-to").value = "";
            dashboardFilterRange = null;
            renderDashboardLeTan();
        }

        function renderDashboardLeTan() {
            initDashboardFilterControls();

            if (!dashboardFilterRange) {
                // Mặc định lần đầu vào Dashboard: lọc theo Tháng hiện tại
                const now = new Date();
                document.getElementById("dash-filter-month").value = now.getMonth() + 1;
                document.getElementById("dash-filter-year").value = now.getFullYear();
                const from = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
                const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                const to = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(lastDay)}`;
                dashboardFilterRange = { from, to, label: `Tháng ${now.getMonth() + 1}/${now.getFullYear()}` };
            }
            const { from, to, label } = dashboardFilterRange;
            const inRange = (dtStr) => {
                const d = getDateOnly(dtStr);
                return !!d && d >= from && d <= to;
            };

            document.getElementById("dashboard-subtitle").innerText = `Số liệu theo khoảng: ${label} (${formatDateVN(from)} - ${formatDateVN(to)})`;
            document.getElementById("dash-conversion-title-period").innerText = `(${label})`;
            document.getElementById("dash-bar-title-period").innerText = `(${label})`;
            document.getElementById("dash-source-title-period").innerText = `(${label})`;
            document.getElementById("dash-service-title-period").innerText = `(${label})`;

            // 1. Tổng số Data trong khoảng đã lọc (dựa theo Thời gian nhận)
            const dataInRangeList = appData.crmdata.filter(x => x.receivedAt && inRange(x.receivedAt));
            document.getElementById("dash-data-thang").innerText = dataInRangeList.length;

            // 2 & 3. Ca phẫu thuật Hoàn thành / Đã hủy trong khoảng đã lọc (dựa theo Thời gian phẫu thuật)
            const surgeryInRangeList = appData.lichphauthuat.filter(x => x.datetime && inRange(x.datetime));
            const surgeryDone = surgeryInRangeList.filter(x => x.status === 'done').length;
            document.getElementById("dash-phauthuat-hoanthanh").innerText = surgeryDone;
            const cancelledSurgery = surgeryInRangeList.filter(x => x.status === 'cancelled').length;
            document.getElementById("dash-tong-huy").innerText = cancelledSurgery;

            // 4. Tổng số ca tư vấn ĐÃ HOÀN THÀNH (trạng thái "Đã đến tư vấn") trong khoảng đã lọc (dựa theo Thời gian hẹn)
            const consultInRangeList = appData.datlichhen.filter(x => x.datetime && inRange(x.datetime));
            document.getElementById("dash-tuvan-dangky").innerText = consultInRangeList.filter(x => x.status === 'arrived').length;

            // 5. Biểu đồ tròn: Tỷ lệ chuyển đổi Data -> Ca tư vấn (trong khoảng đã lọc)
            // Công thức: số ca tư vấn có trạng thái "Đã đến tư vấn" / Tổng data - đo đúng tỷ lệ Data thực sự
            // chuyển đổi thành khách hàng ĐẾN tư vấn trực tiếp, không tính các ca mới chỉ đăng ký/chờ xác nhận
            const dataCount = dataInRangeList.length;
            const consultCount = consultInRangeList.filter(x => x.status === 'arrived').length;
            const conversionRate = dataCount > 0 ? Math.min(100, Math.round((consultCount / dataCount) * 100)) : 0;
            const circumference = 2 * Math.PI * 50;
            const filledLength = (conversionRate / 100) * circumference;
            document.getElementById("dash-conversion-ring").setAttribute("stroke-dasharray", `${filledLength.toFixed(1)} ${circumference.toFixed(1)}`);
            document.getElementById("dash-conversion-text").textContent = `${conversionRate}%`;
            document.getElementById("dash-conversion-data-count").innerText = dataCount;
            document.getElementById("dash-conversion-tuvan-count").innerText = consultCount;

            // 6. Biểu đồ cột: Tổng số Data so với số ca tư vấn của TỪNG NHÂN VIÊN (trong khoảng đã lọc)
            const dataByStaff = {};
            dataInRangeList.forEach(x => {
                if (!x.receiverId) return;
                dataByStaff[x.receiverId] = (dataByStaff[x.receiverId] || 0) + 1;
            });
            const consultByStaff = {};
            consultInRangeList.forEach(x => {
                if (!x.staffId) return;
                consultByStaff[x.staffId] = (consultByStaff[x.staffId] || 0) + 1;
            });
            renderStaffBarChart(dataByStaff, consultByStaff);

            // 7. Biểu đồ tròn: Data theo Nguồn khách hàng (trong khoảng đã lọc)
            const dataBySource = {};
            dataInRangeList.forEach(x => {
                const key = x.sourceId || '__khac__';
                dataBySource[key] = (dataBySource[key] || 0) + 1;
            });
            const sourceRows = Object.entries(dataBySource).map(([sourceId, count]) => {
                const nk = appData.nguonkhach.find(n => n.id === sourceId);
                return { name: nk ? nk.name : 'Chưa xác định', count };
            }).sort((a, b) => b.count - a.count);
            renderSourceDonutChart(sourceRows, dataInRangeList.length);

            // 8. Biểu đồ cột: Ca phẫu thuật ĐÃ THỰC HIỆN (không tính ca Hủy) theo từng loại Dịch vụ
            const doneSurgeries = surgeryInRangeList.filter(x => x.status === 'done');
            const surgeryByService = {};
            doneSurgeries.forEach(x => {
                (x.serviceIds || []).forEach(sid => {
                    surgeryByService[sid] = (surgeryByService[sid] || 0) + 1;
                });
            });
            const serviceRows = Object.entries(surgeryByService).map(([sid, count]) => {
                const dv = appData.dichvu.find(d => d.id === sid);
                return { name: dv ? dv.name : 'Không xác định', count };
            }).sort((a, b) => b.count - a.count);
            renderServiceBarChart(serviceRows);
        }

        // Bảng màu cố định dùng xoay vòng cho biểu đồ tròn nhiều lát cắt (Data theo nguồn khách)
        const DASHBOARD_DONUT_COLORS = ['#b37629', '#1565c0', '#2e7d32', '#8e24aa', '#ef6c00', '#00838f', '#c62828', '#5d4037', '#455a64', '#9e9d24'];

        // Vẽ biểu đồ tròn (donut) nhiều lát cắt bằng CSS conic-gradient thuần, không cần thư viện.
        // rows: [{name, count}] đã sắp xếp giảm dần; total: tổng số để hiển thị giữa vòng tròn + tính %.
        function renderSourceDonutChart(rows, total) {
            document.getElementById("dash-source-total").innerText = total;
            const donutEl = document.getElementById("dash-source-donut");
            const legendEl = document.getElementById("dash-source-legend");

            if (total === 0 || rows.length === 0) {
                donutEl.style.background = '#f0ede4';
                legendEl.innerHTML = `<div class="detail-log-empty" style="padding:10px 0;">Chưa có dữ liệu trong khoảng đã lọc.</div>`;
                return;
            }

            let acc = 0;
            const gradientStops = rows.map((r, i) => {
                const color = DASHBOARD_DONUT_COLORS[i % DASHBOARD_DONUT_COLORS.length];
                const start = acc;
                acc += (r.count / total) * 100;
                return `${color} ${start.toFixed(2)}% ${acc.toFixed(2)}%`;
            });
            donutEl.style.background = `conic-gradient(${gradientStops.join(', ')})`;

            legendEl.innerHTML = rows.map((r, i) => {
                const color = DASHBOARD_DONUT_COLORS[i % DASHBOARD_DONUT_COLORS.length];
                const pct = Math.round((r.count / total) * 100);
                return `
                    <div class="dashboard-donut-legend-item">
                        <div class="dashboard-donut-legend-left">
                            <span class="dashboard-donut-legend-dot" style="background:${color};"></span>
                            <span>${escapeHtml(r.name)}</span>
                        </div>
                        <span style="flex-shrink:0; color:#999;">${r.count} (${pct}%)</span>
                    </div>
                `;
            }).join('');
        }

        // Vẽ biểu đồ cột ngang (1 thanh mỗi dịch vụ) cho "Ca phẫu thuật đã thực hiện theo dịch vụ"
        function renderServiceBarChart(rows) {
            const container = document.getElementById("dash-service-bar-chart");
            if (rows.length === 0) {
                container.innerHTML = `<div class="detail-log-empty">Chưa có ca phẫu thuật nào đã thực hiện trong khoảng đã lọc.</div>`;
                return;
            }
            const maxVal = Math.max(...rows.map(r => r.count), 1);
            container.innerHTML = rows.map(r => `
                <div class="dashboard-bar-row">
                    <div class="dashboard-bar-name">${escapeHtml(r.name)}</div>
                    <div class="dashboard-bar-line">
                        <div class="dashboard-bar-track"><div class="dashboard-bar-fill" style="width:${(r.count / maxVal * 100).toFixed(1)}%; background:#00838f;"></div></div>
                        <span class="dashboard-bar-num">${r.count}</span>
                    </div>
                </div>
            `).join('');
        }

        // Vẽ biểu đồ cột (2 thanh ngang mỗi nhân viên: Data / Ca tư vấn) bằng HTML/CSS thuần, không cần thư viện
        function renderStaffBarChart(dataByStaff, consultByStaff) {
            const container = document.getElementById("dash-staff-bar-chart");
            const staffIds = new Set([...Object.keys(dataByStaff), ...Object.keys(consultByStaff)]);

            const rows = Array.from(staffIds).map(id => {
                const nv = appData.nhanvien.find(n => n.id === id);
                return { name: nv ? nv.name : 'Chưa phân công', data: dataByStaff[id] || 0, tuvan: consultByStaff[id] || 0 };
            }).sort((a, b) => (b.data + b.tuvan) - (a.data + a.tuvan));

            if (rows.length === 0) {
                container.innerHTML = `<div class="detail-log-empty">Chưa có dữ liệu trong khoảng đã lọc.</div>`;
                return;
            }

            const maxVal = Math.max(...rows.map(r => Math.max(r.data, r.tuvan)), 1);

            container.innerHTML = rows.map(r => `
                <div class="dashboard-bar-row">
                    <div class="dashboard-bar-name">${escapeHtml(r.name)}</div>
                    <div class="dashboard-bar-line">
                        <div class="dashboard-bar-track"><div class="dashboard-bar-fill" style="width:${(r.data / maxVal * 100).toFixed(1)}%; background:var(--bronze);"></div></div>
                        <span class="dashboard-bar-num">${r.data}</span>
                    </div>
                    <div class="dashboard-bar-line">
                        <div class="dashboard-bar-track"><div class="dashboard-bar-fill" style="width:${(r.tuvan / maxVal * 100).toFixed(1)}%; background:#1565c0;"></div></div>
                        <span class="dashboard-bar-num">${r.tuvan}</span>
                    </div>
                </div>
            `).join('');
        }

        // 6A. XỬ LÝ DANH SÁCH DATA (SUB-MENU CỦA NHẬP LIỆU LỄ TÂN)
        // Cấu hình hiển thị + màu sắc theo từng trạng thái xử lý data
        function getDataStatusInfo(status) {
            switch (status) {
                case 'tham_khao': return { label: 'Tham khảo', bg: '#e3f2fd', color: '#1565c0', border: '#1565c0' };
                case 'data_ao': return { label: 'Data ảo', bg: '#fdecea', color: '#c62828', border: '#c62828' };
                case 'quan_tam_tra_gop': return { label: 'Quan tâm trả góp', bg: '#f3e5f5', color: '#7b1fa2', border: '#7b1fa2' };
                case 'khach_tiem_nang': return { label: 'Khách tiềm năng', bg: '#fff8e1', color: '#a67c00', border: '#f0d774' };
                case 'chot_hen': return { label: 'Chốt hẹn', bg: '#e8f5e9', color: '#2e7d32', border: '#2e7d32' };
                case 'khong_lien_he':
                default: return { label: 'Không liên hệ được', bg: '#f5f5f5', color: '#616161', border: '#bdbdbd' };
            }
        }

        function openCrmDataFilterModal() {
            const receiverSelect = document.getElementById("filter-cd-receiver");
            const leTanStaff = getLeTanStaffList();
            receiverSelect.innerHTML = `<option value="">-- Tất cả nhân viên nhận --</option>` +
                leTanStaff.map(nv => `<option value="${nv.id}">${nv.name}</option>`).join('');

            const statusSelect = document.getElementById("filter-cd-status");
            const statusValues = ['tham_khao', 'data_ao', 'quan_tam_tra_gop', 'khach_tiem_nang', 'chot_hen', 'khong_lien_he'];
            statusSelect.innerHTML = `<option value="">-- Tất cả trạng thái --</option>` +
                statusValues.map(s => `<option value="${s}">${getDataStatusInfo(s).label}</option>`).join('');

            // Điền lại giá trị bộ lọc hiện tại (nếu có) để người dùng thấy đúng trạng thái đang áp dụng
            receiverSelect.value = advancedCrmDataFilter?.receiverId || "";
            statusSelect.value = advancedCrmDataFilter?.status || "";
            document.getElementById("filter-cd-from").value = advancedCrmDataFilter?.dateFrom || "";
            document.getElementById("filter-cd-to").value = advancedCrmDataFilter?.dateTo || "";
            document.getElementById("modal-loc-crm-data").style.display = "flex";
        }

        function applyCrmDataFilter() {
            const receiverId = document.getElementById("filter-cd-receiver").value;
            const status = document.getElementById("filter-cd-status").value;
            const dateFrom = document.getElementById("filter-cd-from").value;
            const dateTo = document.getElementById("filter-cd-to").value;

            if (dateFrom && dateTo && dateFrom > dateTo) {
                return alert("Khoảng ngày không hợp lệ: 'Từ ngày' phải trước hoặc bằng 'Đến ngày'!");
            }

            if (!receiverId && !status && !dateFrom && !dateTo) {
                advancedCrmDataFilter = null; // Không chọn gì -> coi như không lọc
            } else {
                advancedCrmDataFilter = { receiverId, status, dateFrom, dateTo };
            }
            closeModal('modal-loc-crm-data');
            currentPage = 1;
            renderCrmDataTable();
        }

        function resetCrmDataFilter() {
            advancedCrmDataFilter = null;
            document.getElementById("filter-cd-receiver").value = "";
            document.getElementById("filter-cd-status").value = "";
            document.getElementById("filter-cd-from").value = "";
            document.getElementById("filter-cd-to").value = "";
            closeModal('modal-loc-crm-data');
            currentPage = 1;
            renderCrmDataTable();
        }

        function renderCrmDataTable() {
            const body = document.getElementById("body-crm-data");
            let filtered = appData.crmdata.filter(x =>
                (x.phone || '').toLowerCase().includes(currentSearchQuery) ||
                (x.nickname || '').toLowerCase().includes(currentSearchQuery)
            );

            // CHẾ ĐỘ LỌC NÂNG CAO: lọc thêm theo Nhân viên nhận, Trạng thái, khoảng Ngày nhận data
            const banner = document.getElementById("cd-filter-active-banner");
            if (advancedCrmDataFilter) {
                const { receiverId, status, dateFrom, dateTo } = advancedCrmDataFilter;
                filtered = filtered.filter(x => {
                    if (receiverId && x.receiverId !== receiverId) return false;
                    if (status && x.status !== status) return false;
                    const d = getDateOnly(x.receivedAt);
                    if (dateFrom && (!d || d < dateFrom)) return false;
                    if (dateTo && (!d || d > dateTo)) return false;
                    return true;
                });
                const parts = [];
                if (receiverId) { const nv = appData.nhanvien.find(n => n.id === receiverId); parts.push(`Nhân viên: "${nv ? nv.name : ''}"`); }
                if (status) parts.push(`Trạng thái: "${getDataStatusInfo(status).label}"`);
                if (dateFrom || dateTo) parts.push(`Ngày nhận: ${dateFrom ? formatDateVN(dateFrom) : '...'} - ${dateTo ? formatDateVN(dateTo) : '...'}`);
                document.getElementById("cd-filter-active-text").innerText = `🔍 Đang lọc theo: ${parts.join(' | ')} (${filtered.length} kết quả)`;
                banner.style.display = "flex";
            } else {
                banner.style.display = "none";
            }

            // Data mới nhập luôn được thêm vào CUỐI mảng lưu trữ -> đảo ngược thứ tự để hiển thị data
            // mới nhất lên ĐẦU danh sách, dễ theo dõi các lượt nhập gần đây nhất
            filtered = [...filtered].reverse();

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-cd").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có data khách hàng nào phù hợp với bộ lọc hiện tại.</div>`;
                return;
            }
            document.getElementById("page-bar-cd").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-cd").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} data`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => {
                const nk = appData.nguonkhach.find(n => n.id === x.sourceId);
                const nv = appData.nhanvien.find(n => n.id === x.receiverId);
                const st = getDataStatusInfo(x.status);
                return `
                    <tr>
                        <td class="col-nowrap"><strong>${x.phone}</strong></td>
                        <td>${x.nickname || '<span style="color:#ccc; font-style:italic">Không có</span>'}</td>
                        <td class="col-nowrap">${x.receivedAt ? formatDatetimeVN(x.receivedAt) : '<span style="color:#ccc; font-style:italic">Chưa cập nhật</span>'}</td>
                        <td>${nk ? nk.name : '<span style="color:#ccc; font-style:italic">Chưa xác định</span>'}</td>
                        <td class="col-nowrap">${nv ? nv.name : '<span style="color:#ccc; font-style:italic">Chưa phân công</span>'}</td>
                        <td class="col-nowrap"><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></td>
                        <td style="text-align:center;">
                            <div class="table-actions">
                                <div class="action-dropdown">
                                    <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                    <div class="action-dropdown-menu">
                                        <button type="button" onclick="openCrmDataModal('edit', '${x.id}')">✏️ Sửa</button>
                                        <button type="button" onclick="openCrmDataDetailModal('${x.id}')">👁️ Xem chi tiết</button>
                                        ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteCrmData('${x.id}')">🗑️ Xóa</button>` : ''}
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            renderPaginationButtons(document.getElementById("btn-cd"), totalPages);
        }

        function openCrmDataModal(mode, id = null) {
            const existingCd = mode === 'edit' ? appData.crmdata.find(x => x.id === id) : null;

            const activeNguonKhach = appData.nguonkhach.filter(n => !n.disabled);
            const sourceSelect = document.getElementById("cd-source");
            sourceSelect.innerHTML = `<option value="">-- Chưa xác định --</option>` + activeNguonKhach.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
            if (existingCd && existingCd.sourceId && !activeNguonKhach.some(n => n.id === existingCd.sourceId)) {
                const nkOutside = appData.nguonkhach.find(n => n.id === existingCd.sourceId);
                if (nkOutside) sourceSelect.innerHTML += `<option value="${nkOutside.id}">${nkOutside.name} (Đã vô hiệu hóa)</option>`;
            }

            const receiverSelect = document.getElementById("cd-receiver");
            const leTanStaff = getLeTanStaffList();
            receiverSelect.innerHTML = `<option value="">-- Chưa phân công --</option>` + leTanStaff.map(nv => `<option value="${nv.id}">${nv.name}</option>`).join('');

            if (mode === 'add') {
                document.getElementById("title-modal-cd").innerText = "Thêm Data Mới";
                document.getElementById("edit-cd-id").value = "";
                document.getElementById("edit-cd-version").value = "";
                document.getElementById("cd-phone").value = "";
                document.getElementById("cd-nickname").value = "";
                setDatetimeInputValue('cd-received-time', toDatetimeLocalValue(new Date()));
                document.getElementById("cd-source").value = "";
                document.getElementById("cd-receiver").value = "";
                document.getElementById("cd-status").value = "tham_khao";
            } else {
                document.getElementById("title-modal-cd").innerText = "Cập Nhật Data";
                const cd = existingCd;
                document.getElementById("edit-cd-id").value = cd.id;
                document.getElementById("edit-cd-version").value = cd._v || 1;
                document.getElementById("cd-phone").value = cd.phone;
                document.getElementById("cd-nickname").value = cd.nickname || "";
                setDatetimeInputValue('cd-received-time', cd.receivedAt || toDatetimeLocalValue(new Date()));

                // Nếu nguồn/nhân viên đã gán không còn tồn tại trong danh sách hiện tại, vẫn thêm tạm để không mất dữ liệu
                if (cd.receiverId && !leTanStaff.some(nv => nv.id === cd.receiverId)) {
                    const staffOutside = appData.nhanvien.find(nv => nv.id === cd.receiverId);
                    if (staffOutside) {
                        receiverSelect.innerHTML += `<option value="${staffOutside.id}">${staffOutside.name} (Không khả dụng để chọn mới - đã đổi vai trò hoặc bị khóa)</option>`;
                    }
                }

                document.getElementById("cd-source").value = cd.sourceId || "";
                document.getElementById("cd-receiver").value = cd.receiverId || "";
                document.getElementById("cd-status").value = cd.status;
            }
            document.getElementById("modal-crm-data").style.display = "flex";
        }

        async function saveCrmData() {
            const id = document.getElementById("edit-cd-id").value;
            const phone = document.getElementById("cd-phone").value.trim();
            const nickname = document.getElementById("cd-nickname").value.trim();
            const receivedAt = getDatetimeInputValue('cd-received-time');
            const sourceId = document.getElementById("cd-source").value;
            const receiverId = document.getElementById("cd-receiver").value;
            const status = document.getElementById("cd-status").value;
            const baseVersion = parseInt(document.getElementById("edit-cd-version").value || "1", 10);

            const btn = document.getElementById("btn-save-cd");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                let savedRecord;
                if (!id) {
                    savedRecord = { id: generateUniqueId("cd"), phone, nickname, receivedAt, sourceId, receiverId, status };
                    await saveCrmDataSafely(savedRecord, 'add', null);
                } else {
                    savedRecord = { id, phone, nickname, receivedAt, sourceId, receiverId, status };
                    await saveCrmDataSafely(savedRecord, 'edit', baseVersion);
                }

                // Chọn "Chốt hẹn" và bấm Lưu -> tự động mở popup Đặt lịch hẹn, map sẵn các trường đã có thông tin
                if (status === 'chot_hen') {
                    openLichHenModalFromData(savedRecord);
                }
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Data"; }
            }
        }

        async function deleteCrmData(id) {
            if (!confirm("Bạn có chắc chắn muốn xóa data này?")) return;
            const record = appData.crmdata.find(x => x.id === id);
            const baseVersion = record ? (record._v || 1) : 1;
            await saveCrmDataSafely({ id }, 'delete', baseVersion);
        }

        // Mở popup Đặt lịch hẹn ngay sau khi "Chốt hẹn" từ Danh sách Data - map các trường đã có sẵn thông tin,
        // kể cả Nhân viên nhận Data -> Nhân viên tư vấn (thường là cùng 1 người, vẫn có thể tự đổi lại nếu cần)
        function openLichHenModalFromData(dataRecord) {
            openLichHenModal('add');
            document.getElementById("lh-customer-name").value = dataRecord.nickname || "";
            document.getElementById("lh-phone").value = dataRecord.phone || "";
            document.getElementById("lh-source").value = dataRecord.sourceId || "";

            // Map luôn Nhân viên nhận Data -> Nhân viên tư vấn (thường là cùng 1 người tiếp tục chăm sóc khách),
            // vẫn có thể tự đổi lại nếu cần. Nếu nhân viên đó không còn trong danh sách khả dụng hiện tại
            // (đã đổi vai trò hoặc bị khóa), tự thêm lại vào dropdown kèm ghi chú để không mất thông tin.
            const staffSelect = document.getElementById("lh-staff");
            if (dataRecord.receiverId) {
                if (!Array.from(staffSelect.options).some(opt => opt.value === dataRecord.receiverId)) {
                    const staffOutside = appData.nhanvien.find(nv => nv.id === dataRecord.receiverId);
                    if (staffOutside) {
                        staffSelect.innerHTML += `<option value="${staffOutside.id}">${staffOutside.name} (Không khả dụng để chọn mới - đã đổi vai trò hoặc bị khóa)</option>`;
                    }
                }
                staffSelect.value = dataRecord.receiverId;
            }
        }

        /* Cơ chế chống xung đột dữ liệu (Optimistic Concurrency Control) áp dụng cho Danh sách Data -
           logic giống hệt saveLichHenSafely/saveCrmKhachHangSafely. */
        // So sánh bản ghi cũ/mới để tạo mô tả thay đổi cho "Lịch sử chỉnh sửa"
        function computeCrmDataChanges(oldRec, newRec) {
            const changes = [];
            if ((oldRec.phone || '') !== (newRec.phone || '')) {
                changes.push(`Số điện thoại: "${oldRec.phone || '(trống)'}" → "${newRec.phone || '(trống)'}"`);
            }
            if ((oldRec.nickname || '') !== (newRec.nickname || '')) {
                changes.push(`Tên nick: "${oldRec.nickname || '(trống)'}" → "${newRec.nickname || '(trống)'}"`);
            }
            if ((oldRec.receivedAt || '') !== (newRec.receivedAt || '')) {
                const oldTime = oldRec.receivedAt ? formatDatetimeVN(oldRec.receivedAt) : '(trống)';
                const newTime = newRec.receivedAt ? formatDatetimeVN(newRec.receivedAt) : '(trống)';
                changes.push(`Thời gian nhận: "${oldTime}" → "${newTime}"`);
            }
            if ((oldRec.sourceId || '') !== (newRec.sourceId || '')) {
                const oldName = appData.nguonkhach.find(n => n.id === oldRec.sourceId)?.name || '(chưa xác định)';
                const newName = appData.nguonkhach.find(n => n.id === newRec.sourceId)?.name || '(chưa xác định)';
                changes.push(`Nguồn khách hàng: "${oldName}" → "${newName}"`);
            }
            if ((oldRec.receiverId || '') !== (newRec.receiverId || '')) {
                const oldName = appData.nhanvien.find(n => n.id === oldRec.receiverId)?.name || '(chưa phân công)';
                const newName = appData.nhanvien.find(n => n.id === newRec.receiverId)?.name || '(chưa phân công)';
                changes.push(`Nhân viên nhận: "${oldName}" → "${newName}"`);
            }
            if ((oldRec.status || '') !== (newRec.status || '')) {
                changes.push(`Trạng thái: "${getDataStatusInfo(oldRec.status).label}" → "${getDataStatusInfo(newRec.status).label}"`);
            }
            return changes;
        }

        async function saveCrmDataSafely(record, mode, baseVersion) {
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return;

            if (mode === 'add') {
                record._v = 1;
                record.editHistory = [];
                record.contactLogs = [];
                fresh.crmdata.push(record);
                logActivity('action', 'Danh sách Data', 'Thêm mới', `${record.phone} - ${record.nickname || ''}`, fresh);
            } else if (mode === 'delete') {
                const idx = fresh.crmdata.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    alert("Data này đã được người khác xóa trước đó rồi, không cần thao tác gì thêm.");
                } else {
                    if ((fresh.crmdata[idx]._v || 1) !== (baseVersion || 1)) {
                        const forceDelete = confirm("⚠️ Data này vừa được người khác cập nhật trong lúc bạn thao tác.\n\nBấm OK để VẪN XÓA, hoặc Cancel để hủy và xem dữ liệu mới nhất.");
                        if (!forceDelete) { await persistAppDataSnapshot(fresh); renderCrmDataTable(); return; }
                    }
                    logActivity('action', 'Danh sách Data', 'Xóa', fresh.crmdata[idx].phone, fresh);
                    fresh.crmdata.splice(idx, 1);
                }
            } else { // edit
                const idx = fresh.crmdata.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    const keepMine = confirm("⚠️ Data này đã bị người khác xóa trong lúc bạn đang chỉnh sửa.\n\nBấm OK để LƯU LẠI thông tin của bạn thành một data mới, hoặc Cancel để hủy thao tác.");
                    if (!keepMine) { await persistAppDataSnapshot(fresh); closeModal('modal-crm-data'); renderCrmDataTable(); return; }
                    record._v = 1;
                    record.editHistory = [];
                    record.contactLogs = [];
                    fresh.crmdata.push(record);
                } else {
                    const current = fresh.crmdata[idx];
                    if ((current._v || 1) !== (baseVersion || 1)) {
                        const overwrite = confirm(
                            "⚠️ Data này vừa được người khác cập nhật trong lúc bạn đang chỉnh sửa!\n\n" +
                            "Dữ liệu mới nhất trên hệ thống:\n" +
                            `- SĐT: ${current.phone}\n- Tên nick: ${current.nickname || 'Không có'}\n- Trạng thái: ${getDataStatusInfo(current.status).label}\n\n` +
                            "Bấm OK để GHI ĐÈ bằng thông tin bạn vừa nhập, hoặc Cancel để HỦY và giữ dữ liệu mới nhất."
                        );
                        if (!overwrite) { await persistAppDataSnapshot(fresh); closeModal('modal-crm-data'); renderCrmDataTable(); return; }
                    }
                    // Giữ nguyên lịch sử tư vấn đã có, và ghi thêm 1 mục lịch sử chỉnh sửa nếu có trường nào thay đổi
                    const changes = computeCrmDataChanges(current, record);
                    record.editHistory = current.editHistory || [];
                    if (changes.length > 0) {
                        record.editHistory.push({
                            id: generateUniqueId("eh"),
                            datetime: new Date().toISOString(),
                            changedBy: currentUser ? currentUser.name : 'Admin (Tối cao)',
                            changes
                        });
                    }
                    record.contactLogs = current.contactLogs || [];
                    record._v = (current._v || 1) + 1;
                    fresh.crmdata[idx] = record;
                    logActivity('action', 'Danh sách Data', 'Cập nhật', record.phone, fresh);
                }
            }

            fresh._rev = (fresh._rev || 0) + 1;
            await persistAppDataSnapshot(fresh);
            closeModal('modal-crm-data');
            renderCrmDataTable();
        }

        /* ================= XEM CHI TIẾT DATA: THÔNG TIN + LỊCH SỬ CHỈNH SỬA + LỊCH SỬ TƯ VẤN ================= */
        // Đang sửa lần liên hệ nào (nếu có) - chỉ tồn tại trong bộ nhớ phiên, reset mỗi khi mở lại popup chi tiết
        let editingContactLogId = null;

        // Thoát ký tự HTML để hiển thị an toàn nội dung do người dùng tự nhập (chống vỡ layout/injection)
        function escapeHtml(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        /* ================= AVATAR CHỮ CÁI ĐẦU CHO CÁC DANH SÁCH "NGƯỜI" =================
           Dùng cho các bảng kiểu danh bạ (Nhân viên, Khách hàng...) - lấy chữ cái đầu của tiếng đầu
           và tiếng cuối trong họ tên, tô màu cố định theo tên (cùng 1 người luôn ra cùng 1 màu giữa
           các lần render khác nhau) để giao diện đồng nhất mà không cần lưu thêm dữ liệu màu. */
        const AVATAR_COLOR_PALETTE = ['#b37629', '#2e7d32', '#9d2145', '#0f766e', '#7c5cbf', '#c1541c', '#3c1f18', '#b8860b'];
        function getAvatarInitials(name) {
            const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
            if (parts.length === 0) return '?';
            const first = parts[0].charAt(0);
            const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
            return (first + last).toUpperCase();
        }
        function getAvatarColor(seed) {
            const str = String(seed || '');
            let hash = 0;
            for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
            return AVATAR_COLOR_PALETTE[hash % AVATAR_COLOR_PALETTE.length];
        }
        function renderPersonAvatar(name, seed) {
            return `<span class="avatar-circle" style="background:${getAvatarColor(seed || name)};">${escapeHtml(getAvatarInitials(name))}</span>`;
        }
        // Cập nhật chữ cái đầu trên avatar hồ sơ người dùng ở chân sidebar theo tên vừa đăng nhập
        function updateSidebarUserAvatar(name) {
            const el = document.getElementById("sidebar-user-avatar");
            if (el) el.innerText = getAvatarInitials(name);
        }

        // Danh tính của phiên đăng nhập hiện tại - dùng để xác định ai là "người nhập" một lần liên hệ
        function getCurrentSessionIdentity() {
            return currentUser
                ? { id: currentUser.id, name: currentUser.name }
                : { id: 'admin', name: 'Admin (Tối cao)' };
        }

        // CHỈ người đã tạo ra lần liên hệ đó (đúng phiên đăng nhập) mới được phép sửa nội dung.
        // Dữ liệu cũ (tạo trước khi có trường authorId) sẽ đối chiếu tạm theo tên người tạo.
        function canEditContactLog(log) {
            const identity = getCurrentSessionIdentity();
            if (log.authorId) return log.authorId === identity.id;
            return log.staffName === identity.name;
        }

        function openCrmDataDetailModal(id) {
            const cd = appData.crmdata.find(x => x.id === id);
            if (!cd) { alert("Data này không còn tồn tại (có thể đã bị xóa)."); return; }

            document.getElementById("cd-detail-id").value = id;
            editingContactLogId = null; // luôn bắt đầu ở trạng thái không sửa gì khi mở lại popup

            const nk = appData.nguonkhach.find(n => n.id === cd.sourceId);
            const nv = appData.nhanvien.find(n => n.id === cd.receiverId);
            const st = getDataStatusInfo(cd.status);
            document.getElementById("cd-detail-info").innerHTML = `
                <div class="detail-info-item">
                    <span class="detail-info-label">Số điện thoại</span>
                    <span class="detail-info-value">${escapeHtml(cd.phone)}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Tên nick</span>
                    <span class="detail-info-value">${cd.nickname ? escapeHtml(cd.nickname) : '<span style="color:#ccc; font-weight:400; font-style:italic">Không có</span>'}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Thời gian nhận</span>
                    <span class="detail-info-value">${cd.receivedAt ? formatDatetimeVN(cd.receivedAt) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Nguồn khách hàng</span>
                    <span class="detail-info-value">${nk ? escapeHtml(nk.name) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa xác định</span>'}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Nhân viên nhận</span>
                    <span class="detail-info-value">${nv ? escapeHtml(nv.name) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa phân công</span>'}</span>
                </div>
                <div class="detail-info-item full-width">
                    <span class="detail-info-label">Trạng thái</span>
                    <span><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></span>
                </div>
            `;

            renderCrmDataEditHistory(cd);
            renderCrmDataContactHistory(cd);
            document.getElementById("cd-detail-new-contact-content").value = "";

            // Mặc định luôn mở lại ở tab "Lịch sử chỉnh sửa" mỗi khi mở popup chi tiết
            switchCrmDataDetailTab('edit');
            document.getElementById("modal-crm-data-detail").style.display = "flex";
        }

        function switchCrmDataDetailTab(tabName) {
            const isEdit = tabName === 'edit';
            document.getElementById("detail-tab-btn-edit").classList.toggle("active", isEdit);
            document.getElementById("detail-tab-btn-contact").classList.toggle("active", !isEdit);
            document.getElementById("detail-tab-panel-edit").classList.toggle("active", isEdit);
            document.getElementById("detail-tab-panel-contact").classList.toggle("active", !isEdit);
        }

        function renderCrmDataEditHistory(cd) {
            const container = document.getElementById("cd-detail-edit-history");
            const history = cd.editHistory || [];
            if (history.length === 0) {
                container.innerHTML = `<div class="detail-log-empty" style="grid-column: 1 / -1;">📭 Chưa có lịch sử chỉnh sửa nào.</div>`;
                return;
            }
            // Hiển thị mới nhất lên trước
            const sorted = [...history].sort((a, b) => b.datetime.localeCompare(a.datetime));
            container.innerHTML = sorted.map(h => `
                <div class="cd-history-card log-type-edit">
                    <div class="cd-history-card-top">
                        <div class="cd-history-meta">
                            <span>📝</span>
                            <span class="cd-history-author">${escapeHtml(h.changedBy)}</span>
                            <span>•</span>
                            <span>${formatDatetimeVNFull(h.datetime)}</span>
                        </div>
                    </div>
                    <div class="cd-history-changes">${h.changes.map(c => `<span class="change-line" title="${escapeHtml(c)}">• ${escapeHtml(c)}</span>`).join('')}</div>
                </div>
            `).join('');
        }

        function renderCrmDataContactHistory(cd) {
            const container = document.getElementById("cd-detail-contact-history");
            const logs = cd.contactLogs || [];
            if (logs.length === 0) {
                container.innerHTML = `<div class="detail-log-empty" style="grid-column: 1 / -1;">📭 Chưa có lần liên hệ nào được ghi nhận.</div>`;
                return;
            }
            const sorted = [...logs].sort((a, b) => b.datetime.localeCompare(a.datetime));
            container.innerHTML = sorted.map(l => {
                if (l.id === editingContactLogId) {
                    return `
                        <div class="cd-history-card log-type-contact">
                            <div class="cd-history-card-top">
                                <div class="cd-history-meta">
                                    <span>💬</span>
                                    <span class="cd-history-author">${escapeHtml(l.staffName)}</span>
                                    <span>•</span>
                                    <span>${formatDatetimeVNFull(l.datetime)}</span>
                                </div>
                            </div>
                            <textarea id="contact-log-edit-${l.id}" class="cd-history-edit-textarea" rows="3">${escapeHtml(l.content)}</textarea>
                            <div class="cd-history-edit-actions">
                                <button type="button" class="secondary" onclick="cancelEditContactLog()">Hủy</button>
                                <button type="button" onclick="saveEditContactLog('${l.id}')">Lưu Thay Đổi</button>
                            </div>
                        </div>
                    `;
                }
                return `
                    <div class="cd-history-card log-type-contact">
                        <div class="cd-history-card-top">
                            <div class="cd-history-meta">
                                <span>💬</span>
                                <span class="cd-history-author">${escapeHtml(l.staffName)}</span>
                                <span>•</span>
                                <span>${formatDatetimeVNFull(l.datetime)}</span>
                                ${l.editedAt ? `<span style="font-style:italic; color:#b08d57;">(đã sửa lúc ${formatDatetimeVNFull(l.editedAt)})</span>` : ''}
                            </div>
                            ${canEditContactLog(l) ? `<button type="button" class="cd-history-edit-btn" onclick="startEditContactLog('${l.id}')">✏️ Sửa</button>` : ''}
                        </div>
                        <div class="cd-history-content">${escapeHtml(l.content)}</div>
                    </div>
                `;
            }).join('');
        }

        function startEditContactLog(logId) {
            const id = document.getElementById("cd-detail-id").value;
            const cd = appData.crmdata.find(x => x.id === id);
            if (!cd) return;
            const log = (cd.contactLogs || []).find(l => l.id === logId);
            if (!log || !canEditContactLog(log)) { alert("Bạn chỉ có thể sửa nội dung của những lần liên hệ do chính bạn ghi nhận!"); return; }
            editingContactLogId = logId;
            renderCrmDataContactHistory(cd);
        }

        function cancelEditContactLog() {
            const id = document.getElementById("cd-detail-id").value;
            const cd = appData.crmdata.find(x => x.id === id);
            editingContactLogId = null;
            if (cd) renderCrmDataContactHistory(cd);
        }

        async function saveEditContactLog(logId) {
            const id = document.getElementById("cd-detail-id").value;
            const textarea = document.getElementById(`contact-log-edit-${logId}`);
            const newContent = textarea.value.trim();
            if (!newContent) return alert("Nội dung lần liên hệ không được để trống!");

            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return;
            const idx = fresh.crmdata.findIndex(x => x.id === id);
            if (idx === -1) {
                alert("Data này đã bị xóa trong lúc bạn đang thao tác.");
                await persistAppDataSnapshot(fresh);
                closeModal('modal-crm-data-detail');
                renderCrmDataTable();
                return;
            }

            const logs = fresh.crmdata[idx].contactLogs || [];
            const log = logs.find(l => l.id === logId);
            if (!log) {
                alert("Lần liên hệ này đã bị xóa hoặc không còn tồn tại.");
            } else if (!canEditContactLog(log)) {
                alert("Bạn chỉ có thể sửa nội dung của những lần liên hệ do chính bạn ghi nhận!");
                editingContactLogId = null;
                await persistAppDataSnapshot(fresh);
                renderCrmDataContactHistory(fresh.crmdata[idx]);
                return;
            } else {
                log.content = newContent;
                log.editedAt = new Date().toISOString();
            }

            fresh.crmdata[idx]._v = (fresh.crmdata[idx]._v || 1) + 1;
            fresh._rev = (fresh._rev || 0) + 1;
            await persistAppDataSnapshot(fresh);

            editingContactLogId = null;
            renderCrmDataTable();
            renderCrmDataContactHistory(fresh.crmdata[idx]);
        }

        // Định dạng ISO datetime đầy đủ -> "dd/mm/yyyy HH:mm"
        function formatDatetimeVNFull(isoStr) {
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return isoStr;
            return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
        }

        async function addContactLogEntry() {
            const id = document.getElementById("cd-detail-id").value;
            const contentEl = document.getElementById("cd-detail-new-contact-content");
            const content = contentEl.value.trim();
            if (!content) return alert("Vui lòng nhập nội dung đã tư vấn cho lần liên hệ này!");

            const btn = document.getElementById("btn-add-contact-log");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                const fresh = await readFreshAppDataSnapshotOrWarn();
                if (!fresh) return;
                const idx = fresh.crmdata.findIndex(x => x.id === id);
                if (idx === -1) {
                    alert("Data này đã bị xóa trong lúc bạn đang thao tác, không thể ghi nhận thêm lần liên hệ.");
                    await persistAppDataSnapshot(fresh);
                    closeModal('modal-crm-data-detail');
                    renderCrmDataTable();
                    return;
                }

                if (!fresh.crmdata[idx].contactLogs) fresh.crmdata[idx].contactLogs = [];
                fresh.crmdata[idx].contactLogs.push({
                    id: generateUniqueId("cl"),
                    datetime: new Date().toISOString(),
                    content,
                    staffName: currentUser ? currentUser.name : 'Admin (Tối cao)',
                    authorId: currentUser ? currentUser.id : 'admin'
                });
                fresh.crmdata[idx]._v = (fresh.crmdata[idx]._v || 1) + 1;
                fresh._rev = (fresh._rev || 0) + 1;

                await persistAppDataSnapshot(fresh);
                renderCrmDataTable();

                // Cập nhật lại nội dung modal chi tiết đang mở, giữ nguyên ở tab Lịch sử tư vấn
                renderCrmDataContactHistory(fresh.crmdata[idx]);
                contentEl.value = "";
                switchCrmDataDetailTab('contact');
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "+ Ghi Nhận Lần Liên Hệ"; }
            }
        }

        // 6B. XỬ LÝ CRM - DANH SÁCH KHÁCH HÀNG (SUB-MENU CỦA CRM)
        // Đây là danh sách khách hàng TỔNG của cả hệ thống (master registry), áp dụng cùng cơ chế
        // chống xung đột dữ liệu (optimistic concurrency control) như module Đặt lịch hẹn.
        function renderCrmKhachHangTable() {
            const body = document.getElementById("body-crm-khach-hang");
            const filtered = appData.crmkhachhang.filter(x =>
                x.customerName.toLowerCase().includes(currentSearchQuery) ||
                (x.phone || '').toLowerCase().includes(currentSearchQuery) ||
                (x.code || '').toLowerCase().includes(currentSearchQuery) ||
                (x.cccd || '').toLowerCase().includes(currentSearchQuery)
            );

            if(filtered.length === 0) {
                body.innerHTML = ""; document.getElementById("page-bar-ck").style.display = "none";
                document.getElementById("empty-state-global").innerHTML = `<div class="empty-state">Chưa có khách hàng nào trong hệ thống.</div>`;
                return;
            }
            document.getElementById("page-bar-ck").style.display = "flex";

            const totalPages = Math.ceil(filtered.length / rowsPerPage);
            const startIndex = (currentPage - 1) * rowsPerPage;
            const endIndex = Math.min(startIndex + rowsPerPage, filtered.length);
            document.getElementById("info-ck").innerText = `Hiển thị ${startIndex + 1} - ${endIndex} trên ${filtered.length} khách hàng`;

            const pageData = filtered.slice(startIndex, endIndex);
            body.innerHTML = pageData.map(x => `
                <tr>
                    <td><strong>${x.code || ''}</strong></td>
                    <td><div class="person-cell">${renderPersonAvatar(x.customerName, x.id)}<span style="font-weight:600; color:var(--dark-brown);">${x.customerName}</span></div></td>
                    <td>${x.phone}</td>
                    <td style="font-size:13px; color:var(--gray-text);">${x.address || '<span style="color:#ccc">Chưa cập nhật</span>'}</td>
                    <td>${x.dob ? formatDateVN(x.dob) : '<span style="color:#ccc">Chưa cập nhật</span>'}</td>
                    <td>${x.cccd || '<span style="color:#ccc">Chưa cập nhật</span>'}</td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openCrmKhachHangModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="openCrmKhachHangDetailModal('${x.id}')">👁️ Xem chi tiết</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteCrmKhachHang('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `).join('');

            renderPaginationButtons(document.getElementById("btn-ck"), totalPages);
        }

        async function openCrmKhachHangModal(mode, id = null) {
            const staffSelect = document.getElementById("ck-staff");
            const leTanStaff = getLeTanStaffList();
            staffSelect.innerHTML = `<option value="">-- Chưa phân công --</option>` +
                (leTanStaff.length > 0
                    ? leTanStaff.map(nv => `<option value="${nv.id}">${nv.name}</option>`).join('')
                    : '');

            if (mode === 'add') {
                document.getElementById("title-modal-ck").innerText = "Thêm Khách Hàng Mới";
                document.getElementById("edit-ck-id").value = "";
                document.getElementById("edit-ck-version").value = "";
                document.getElementById("ck-code").value = "Đang tạo mã...";
                document.getElementById("ck-customer-name").value = "";
                document.getElementById("ck-phone").value = "";
                document.getElementById("ck-address").value = "";
                document.getElementById("ck-dob").value = "";
                document.getElementById("ck-cccd").value = "";
                document.getElementById("ck-gender").value = "";
                document.getElementById("ck-cccd-issue-place").value = "";
                document.getElementById("ck-cccd-issue-date").value = "";
                document.getElementById("ck-service-desc").value = "";
                setDatetimeInputValue('ck-surgery-datetime', '');
                document.getElementById("ck-staff").value = "";
                document.getElementById("ck-hoptac").checked = false;
                document.getElementById("modal-crm-khach-hang").style.display = "flex";
                // Xem trước mã khách hàng tiếp theo (KHÔNG tăng bộ đếm) - DÙNG CHUNG bộ đếm với Lịch phẫu
                // thuật, có thể tự chỉnh sửa lại sau khi đã điền. Bộ đếm chỉ thực sự tăng khi bấm Lưu.
                const autoCode = await previewSurgeryCode();
                document.getElementById("ck-code").value = autoCode || "Lỗi tạo mã - vui lòng tải lại trang";
                return;
            } else {
                document.getElementById("title-modal-ck").innerText = "Cập Nhật Khách Hàng";
                const ck = appData.crmkhachhang.find(x => x.id === id);
                document.getElementById("edit-ck-id").value = ck.id;
                // Ghi nhớ phiên bản (_v) TẠI THỜI ĐIỂM MỞ FORM để phát hiện xung đột lúc lưu (giống Đặt lịch hẹn)
                document.getElementById("edit-ck-version").value = ck._v || 1;
                document.getElementById("ck-code").value = ck.code || "";
                document.getElementById("ck-customer-name").value = ck.customerName;
                document.getElementById("ck-phone").value = ck.phone;
                document.getElementById("ck-address").value = ck.address || "";
                document.getElementById("ck-dob").value = ck.dob || "";
                document.getElementById("ck-cccd").value = ck.cccd || "";
                document.getElementById("ck-gender").value = ck.gender || "";
                document.getElementById("ck-cccd-issue-place").value = ck.cccdIssuePlace || "";
                document.getElementById("ck-cccd-issue-date").value = ck.cccdIssueDate || "";
                document.getElementById("ck-service-desc").value = ck.serviceDesc || "";
                setDatetimeInputValue('ck-surgery-datetime', ck.surgeryDatetime || '');

                if (ck.staffId && !leTanStaff.some(nv => nv.id === ck.staffId)) {
                    const staffOutside = appData.nhanvien.find(nv => nv.id === ck.staffId);
                    if (staffOutside) {
                        staffSelect.innerHTML += `<option value="${staffOutside.id}">${staffOutside.name} (Không khả dụng để chọn mới - đã đổi vai trò hoặc bị khóa)</option>`;
                    }
                }
                document.getElementById("ck-staff").value = ck.staffId || "";
                document.getElementById("ck-hoptac").checked = ck.hoptac || false;
            }
            document.getElementById("modal-crm-khach-hang").style.display = "flex";
        }

        async function saveCrmKhachHang() {
            const id = document.getElementById("edit-ck-id").value;
            const code = document.getElementById("ck-code").value.trim().toUpperCase();
            const customerName = document.getElementById("ck-customer-name").value.trim();
            const phone = document.getElementById("ck-phone").value.trim();
            const address = document.getElementById("ck-address").value.trim();
            const dob = document.getElementById("ck-dob").value;
            const cccd = document.getElementById("ck-cccd").value.trim();
            const gender = document.getElementById("ck-gender").value;
            const cccdIssuePlace = document.getElementById("ck-cccd-issue-place").value.trim();
            const cccdIssueDate = document.getElementById("ck-cccd-issue-date").value;
            const serviceDesc = document.getElementById("ck-service-desc").value.trim();
            const surgeryDatetime = getDatetimeInputValue('ck-surgery-datetime');
            const staffId = document.getElementById("ck-staff").value;
            const hoptac = document.getElementById("ck-hoptac").checked;
            const baseVersion = parseInt(document.getElementById("edit-ck-version").value || "1", 10);

            if (!code || !customerName || !phone) return alert("Vui lòng điền đủ Mã khách hàng, Tên khách hàng và Số điện thoại!");
            if (!cccd) return alert("Vui lòng điền CCCD/Passport!");
            if (!/^[A-Za-z0-9]+$/.test(cccd)) return alert("CCCD/Passport chỉ được chứa chữ và số, không chứa khoảng trắng hay ký tự đặc biệt!");

            // Cảnh báo nếu mã này đã có lịch sử phẫu thuật của một khách hàng KHÁC đã bị xóa (tránh nhận nhầm lịch sử)
            if (!id && hasOrphanedHistoryForCode(code)) {
                if (!confirmOrphanedCodeReuse(code)) return;
            }

            const btn = document.getElementById("btn-save-ck");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                if (!id) {
                    if (appData.crmkhachhang.some(x => x.code === code)) return alert("Mã khách hàng này đã hiện hữu!");
                    const newRecord = { id: generateUniqueId("ck"), code, customerName, phone, address, dob, cccd, gender, cccdIssuePlace, cccdIssueDate, serviceDesc, surgeryDatetime, staffId, hoptac };
                    await saveCrmKhachHangSafely(newRecord, 'add', null);
                } else {
                    if (appData.crmkhachhang.some(x => x.code === code && x.id !== id)) return alert("Mã khách hàng này đã được dùng cho khách hàng khác!");
                    const updatedRecord = { id, code, customerName, phone, address, dob, cccd, gender, cccdIssuePlace, cccdIssueDate, serviceDesc, surgeryDatetime, staffId, hoptac };
                    await saveCrmKhachHangSafely(updatedRecord, 'edit', baseVersion);
                }
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Khách Hàng"; }
            }
        }

        async function deleteCrmKhachHang(id) {
            if (!confirm("Bạn có chắc chắn muốn xóa khách hàng này khỏi hệ thống?")) return;
            const record = appData.crmkhachhang.find(x => x.id === id);
            const baseVersion = record ? (record._v || 1) : 1;
            await saveCrmKhachHangSafely({ id }, 'delete', baseVersion);
        }

        /* Cơ chế chống xung đột dữ liệu (Optimistic Concurrency Control) áp dụng riêng cho Danh sách khách hàng -
           logic giống hệt saveLichHenSafely (đọc lại dữ liệu mới nhất, merge theo từng bản ghi, phát hiện
           xung đột theo _v trước khi ghi đè), tái sử dụng readFreshAppDataSnapshot/persistAppDataSnapshot. */
        async function saveCrmKhachHangSafely(record, mode, baseVersion) {
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return;

            if (mode === 'add') {
                record._v = 1;
                fresh.crmkhachhang.push(record);
                logActivity('action', 'CRM Khách hàng', 'Thêm mới', `${record.code} - ${record.customerName}`, fresh);
                // Chỉ THỰC SỰ tăng bộ đếm mã (dùng chung với Lịch phẫu thuật) khi lưu thành công,
                // tránh lãng phí số nếu người dùng mở form rồi hủy mà không lưu gì.
                if (!fresh.surgeryCodeConfig) fresh.surgeryCodeConfig = { prefix: "PT", digits: 4, nextNumber: 1 };
                fresh.surgeryCodeConfig.nextNumber = (fresh.surgeryCodeConfig.nextNumber || 1) + 1;
            } else if (mode === 'delete') {
                const idx = fresh.crmkhachhang.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    alert("Khách hàng này đã được người khác xóa trước đó rồi, không cần thao tác gì thêm.");
                } else {
                    if ((fresh.crmkhachhang[idx]._v || 1) !== (baseVersion || 1)) {
                        const forceDelete = confirm("⚠️ Khách hàng này vừa được người khác cập nhật trong lúc bạn thao tác.\n\nBấm OK để VẪN XÓA, hoặc Cancel để hủy và xem dữ liệu mới nhất.");
                        if (!forceDelete) { await persistAppDataSnapshot(fresh); renderCrmKhachHangTable(); return; }
                    }
                    logActivity('action', 'CRM Khách hàng', 'Xóa', `${fresh.crmkhachhang[idx].code} - ${fresh.crmkhachhang[idx].customerName}`, fresh);
                    fresh.crmkhachhang.splice(idx, 1);
                }
            } else { // edit
                const idx = fresh.crmkhachhang.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    const keepMine = confirm("⚠️ Khách hàng này đã bị người khác xóa trong lúc bạn đang chỉnh sửa.\n\nBấm OK để LƯU LẠI thông tin của bạn thành một khách hàng mới, hoặc Cancel để hủy thao tác.");
                    if (!keepMine) { await persistAppDataSnapshot(fresh); closeModal('modal-crm-khach-hang'); renderCrmKhachHangTable(); return; }
                    record._v = 1;
                    fresh.crmkhachhang.push(record);
                } else {
                    const current = fresh.crmkhachhang[idx];
                    if ((current._v || 1) !== (baseVersion || 1)) {
                        const overwrite = confirm(
                            "⚠️ Khách hàng này vừa được người khác cập nhật trong lúc bạn đang chỉnh sửa!\n\n" +
                            "Dữ liệu mới nhất trên hệ thống:\n" +
                            `- Mã KH: ${current.code}\n- Tên: ${current.customerName}\n- SĐT: ${current.phone}\n\n` +
                            "Bấm OK để GHI ĐÈ bằng thông tin bạn vừa nhập, hoặc Cancel để HỦY và giữ dữ liệu mới nhất."
                        );
                        if (!overwrite) { await persistAppDataSnapshot(fresh); closeModal('modal-crm-khach-hang'); renderCrmKhachHangTable(); return; }
                    }
                    record._v = (current._v || 1) + 1;
                    fresh.crmkhachhang[idx] = record;
                    logActivity('action', 'CRM Khách hàng', 'Cập nhật', `${record.code} - ${record.customerName}`, fresh);
                }
            }

            fresh._rev = (fresh._rev || 0) + 1;
            await persistAppDataSnapshot(fresh);
            closeModal('modal-crm-khach-hang');
            renderCrmKhachHangTable();
        }

        /* ================= XEM CHI TIẾT KHÁCH HÀNG: THÔNG TIN + LỊCH SỬ KHÁM TƯ VẤN + LỊCH SỬ PHẪU THUẬT ================= */
        // Đối chiếu dữ liệu liên quan tới khách hàng bằng Số điện thoại (Đặt lịch hẹn tư vấn không có Mã khách hàng)
        // và bằng Mã khách hàng HOẶC Số điện thoại (Lịch phẫu thuật, vì đây là nguồn đồng bộ chính của Mã khách hàng).
        function getCkRelatedConsultAppointments(ck) {
            if (!ck.phone) return [];
            return appData.datlichhen.filter(x => x.phone === ck.phone);
        }
        function getCkRelatedSurgeries(ck) {
            return appData.lichphauthuat.filter(x => (ck.code && x.code === ck.code) || (ck.phone && x.phone === ck.phone));
        }
        // Đặt lịch tái khám, thay băng, cắt chỉ cũng không có Mã khách hàng -> đối chiếu bằng Số điện thoại
        function getCkRelatedTaiKham(ck) {
            if (!ck.phone) return [];
            return appData.taikham.filter(x => x.phone === ck.phone);
        }

        function openCrmKhachHangDetailModal(id) {
            const ck = appData.crmkhachhang.find(x => x.id === id);
            if (!ck) { alert("Khách hàng này không còn tồn tại (có thể đã bị xóa)."); return; }

            document.getElementById("ck-detail-info").innerHTML = `
                <div class="detail-info-item">
                    <span class="detail-info-label">Mã khách hàng</span>
                    <span class="detail-info-value">${escapeHtml(ck.code || '')}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Tên khách hàng</span>
                    <span class="detail-info-value">${escapeHtml(ck.customerName)}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Số điện thoại</span>
                    <span class="detail-info-value">${escapeHtml(ck.phone)}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Địa chỉ</span>
                    <span class="detail-info-value">${ck.address ? escapeHtml(ck.address) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Ngày sinh</span>
                    <span class="detail-info-value">${ck.dob ? formatDateVN(ck.dob) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Giới tính</span>
                    <span class="detail-info-value">${ck.gender === 'nam' ? 'Nam' : ck.gender === 'nu' ? 'Nữ' : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa xác định</span>'}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">CCCD / Passport</span>
                    <span class="detail-info-value">${ck.cccd ? escapeHtml(ck.cccd) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Nơi cấp / Ngày cấp</span>
                    <span class="detail-info-value">${ck.cccdIssuePlace ? escapeHtml(ck.cccdIssuePlace) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}${ck.cccdIssueDate ? ' - ' + formatDateVN(ck.cccdIssueDate) : ''}</span>
                </div>
                <div class="detail-info-item">
                    <span class="detail-info-label">Khách hợp tác</span>
                    <span class="detail-info-value">${ck.hoptac ? '<span class="appointment-status-badge" style="background:#e8f5e9; color:#2e7d32; border-color:#2e7d32;">🤝 Có</span>' : '<span style="color:#ccc; font-weight:400; font-style:italic">Không</span>'}</span>
                </div>
                <div class="detail-info-item full-width">
                    <span class="detail-info-label">Mô tả dịch vụ</span>
                    <span class="detail-info-value" style="font-weight:400;">${ck.serviceDesc ? escapeHtml(ck.serviceDesc) : '<span style="color:#ccc; font-style:italic">Chưa cập nhật</span>'}</span>
                </div>
            `;

            renderCkServicesUsed(ck);
            renderCkConsultHistory(ck);
            renderCkTaiKhamHistory(ck);
            renderCkSurgeryHistory(ck);

            switchCkDetailTab('consult');
            document.getElementById("modal-crm-khach-hang-detail").style.display = "flex";
        }

        function switchCkDetailTab(tabName) {
            const isConsult = tabName === 'consult';
            const isTaiKham = tabName === 'taikham';
            const isSurgery = tabName === 'surgery';
            document.getElementById("detail-tab-btn-ck-consult").classList.toggle("active", isConsult);
            document.getElementById("detail-tab-btn-ck-taikham").classList.toggle("active", isTaiKham);
            document.getElementById("detail-tab-btn-ck-surgery").classList.toggle("active", isSurgery);
            document.getElementById("detail-tab-panel-ck-consult").classList.toggle("active", isConsult);
            document.getElementById("detail-tab-panel-ck-taikham").classList.toggle("active", isTaiKham);
            document.getElementById("detail-tab-panel-ck-surgery").classList.toggle("active", isSurgery);
        }

        // Tổng hợp danh sách dịch vụ (không trùng lặp) đã dùng qua cả lịch sử khám tư vấn và lịch sử phẫu thuật
        function renderCkServicesUsed(ck) {
            const container = document.getElementById("ck-detail-services-used");
            const consultAppointments = getCkRelatedConsultAppointments(ck);
            const surgeries = getCkRelatedSurgeries(ck);

            const usedServiceIds = new Set();
            consultAppointments.forEach(x => (x.serviceIds || []).forEach(sid => usedServiceIds.add(sid)));
            surgeries.forEach(x => (x.serviceIds || []).forEach(sid => usedServiceIds.add(sid)));

            const serviceNames = Array.from(usedServiceIds)
                .map(sid => appData.dichvu.find(d => d.id === sid))
                .filter(Boolean)
                .map(d => d.name);

            if (serviceNames.length === 0) {
                container.innerHTML = `<span style="color:#bbb; font-style:italic; font-size:13px;">Chưa ghi nhận dịch vụ nào.</span>`;
                return;
            }
            container.innerHTML = serviceNames.map(name => `<span class="appointment-status-badge" style="background:#eef2f7; color:var(--dark-brown); border-color:var(--gold); margin: 2px 4px 2px 0;">${escapeHtml(name)}</span>`).join('');
        }

        function renderCkConsultHistory(ck) {
            const container = document.getElementById("ck-detail-consult-history");
            const list = [...getCkRelatedConsultAppointments(ck)].sort((a, b) => b.datetime.localeCompare(a.datetime));

            if (list.length === 0) {
                container.innerHTML = `<div class="detail-log-empty" style="grid-column: 1 / -1;">📭 Chưa có lịch sử khám tư vấn nào.</div>`;
                return;
            }
            container.innerHTML = list.map(x => {
                const serviceNames = (x.serviceIds || [])
                    .map(sid => appData.dichvu.find(d => d.id === sid))
                    .filter(Boolean)
                    .map(d => d.name);
                const st = getStatusInfo(x.status);
                return `
                    <div class="ck-history-card log-type-contact">
                        <div class="ck-history-card-top">
                            <span class="ck-history-date">📅 ${formatDatetimeVN(x.datetime)}</span>
                            <span class="appointment-status-badge" style="font-size:10px; padding:2px 7px; background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span>
                        </div>
                        <div class="ck-history-content" title="${escapeHtml(serviceNames.join(', '))}">${serviceNames.length > 0 ? escapeHtml(serviceNames.join(', ')) : '<span style="color:#ccc; font-style:italic">Chưa chọn dịch vụ</span>'}</div>
                    </div>
                `;
            }).join('');
        }

        // Lịch sử Tái khám, Thay Băng, Cắt chỉ - chỉ cần hiển thị loại dịch vụ + ngày thực hiện + trạng thái thực hiện
        function renderCkTaiKhamHistory(ck) {
            const container = document.getElementById("ck-detail-taikham-history");
            const list = [...getCkRelatedTaiKham(ck)].sort((a, b) => b.datetime.localeCompare(a.datetime));

            if (list.length === 0) {
                container.innerHTML = `<div class="detail-log-empty" style="grid-column: 1 / -1;">📭 Chưa có lịch sử tái khám, thay băng, cắt chỉ nào.</div>`;
                return;
            }
            container.innerHTML = list.map(x => {
                const serviceLabels = (x.executionServices || []).map(v => getExecutionServiceLabel(v));
                const st = getStatusInfo(x.status);
                return `
                    <div class="ck-history-card log-type-contact">
                        <div class="ck-history-card-top">
                            <span class="ck-history-date">🩹 ${formatDatetimeVN(x.datetime)}</span>
                            <span class="appointment-status-badge" style="font-size:10px; padding:2px 7px; background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span>
                        </div>
                        <div class="ck-history-content" title="${escapeHtml(serviceLabels.join(', '))}">${serviceLabels.length > 0 ? escapeHtml(serviceLabels.join(', ')) : '<span style="color:#ccc; font-style:italic">Chưa chọn dịch vụ</span>'}</div>
                    </div>
                `;
            }).join('');
        }


        function renderCkSurgeryHistory(ck) {
            const container = document.getElementById("ck-detail-surgery-history");
            const list = [...getCkRelatedSurgeries(ck)].sort((a, b) => b.datetime.localeCompare(a.datetime));

            if (list.length === 0) {
                container.innerHTML = `<div class="detail-log-empty" style="grid-column: 1 / -1;">📭 Chưa có lịch sử phẫu thuật nào.</div>`;
                return;
            }
            container.innerHTML = list.map(x => {
                const serviceNames = (x.serviceIds || [])
                    .map(sid => appData.dichvu.find(d => d.id === sid))
                    .filter(Boolean)
                    .map(d => d.name);
                const st = getSurgeryStatusInfo(x.status);
                const fullText = serviceNames.join(', ') + (x.serviceDesc ? ' - ' + x.serviceDesc : '');
                return `
                    <div class="ck-history-card log-type-edit">
                        <div class="ck-history-card-top">
                            <span class="ck-history-date">🏥 ${formatDatetimeVN(x.datetime)}</span>
                            <span class="appointment-status-badge" style="font-size:10px; padding:2px 7px; background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span>
                        </div>
                        <div class="ck-history-content" title="${escapeHtml(fullText)}">${serviceNames.length > 0 ? escapeHtml(serviceNames.join(', ')) : '<span style="color:#ccc; font-style:italic">Chưa chọn dịch vụ</span>'}${x.serviceDesc ? '<br><em>' + escapeHtml(x.serviceDesc) + '</em>' : ''}</div>
                    </div>
                `;
            }).join('');
        }

        // 5. XỬ LÝ ĐẶT LỊCH HẸN (SUB-MENU CỦA NHẬP LIỆU LỄ TÂN)
        // Cấu hình hiển thị + màu sắc theo từng trạng thái lịch hẹn
        function getStatusInfo(status) {
            switch (status) {
                case 'confirmed': return { label: 'Đã xác nhận lịch', bg: '#e8f5e9', color: '#2e7d32', border: '#2e7d32' };
                case 'arrived': return { label: 'Đã đến tư vấn', bg: '#f3e5f5', color: '#7b1fa2', border: '#7b1fa2' };
                case 'completed': return { label: 'Hoàn thành', bg: '#e1f5fe', color: '#0277bd', border: '#0277bd' };
                case 'cancelled': return { label: 'Hủy', bg: '#fdecea', color: '#c62828', border: '#c62828' };
                case 'pending':
                default: return { label: 'Chờ xác nhận', bg: '#fff8e1', color: '#a67c00', border: '#f0d774' };
            }
        }

        /* ================= LƯỚI LỊCH THÁNG DÙNG CHUNG (CHO CẢ ĐẶT LỊCH HẸN TƯ VẤN VÀ LỊCH PHẪU THUẬT) ================= */
        // Trả về HTML phần lưới ngày trong tháng (không kèm header điều hướng tháng - mỗi module tự ghép header riêng).
        // records: danh sách bản ghi cần hiển thị; monthDate: Date bất kỳ trong tháng đang xem;
        // getDatetimeFn: hàm lấy chuỗi datetime-local từ 1 bản ghi; renderChipFn: hàm trả về HTML của 1 "chip" lịch trong ô ngày.
        // Số lịch tối đa hiển thị trực tiếp trong 1 ô ngày trước khi gộp thành nút "+N lịch khác"
        const CAL_MAX_VISIBLE_CHIPS = 4;

        // Mở popup hiển thị TOÀN BỘ lịch của 1 ngày cụ thể (dùng khi ngày đó có nhiều hơn CAL_MAX_VISIBLE_CHIPS lịch).
        // Dữ liệu + cách render từng "chip" được lấy từ biến toàn cục do buildMonthCalendarGridHTML lưu tạm lúc dựng lưới,
        // nên popup này dùng chung được cho cả 3 module (Đặt lịch hẹn tư vấn / Tái khám / Lịch phẫu thuật).
        function openCalendarDayListModal(dateKey) {
            const records = (window.calendarDayRecordsMap && window.calendarDayRecordsMap[dateKey]) || [];
            const renderChipFn = window.calendarDayChipRenderer;
            document.getElementById("calendar-day-list-title").innerText = `Lịch ngày ${formatDateVN(dateKey)} (${records.length} lịch)`;
            document.getElementById("calendar-day-list-items").innerHTML = records.length > 0 && renderChipFn
                ? records.map(r => renderChipFn(r)).join('')
                : `<div class="detail-log-empty">Không có lịch nào trong ngày này.</div>`;
            document.getElementById("modal-calendar-day-list").style.display = "flex";
        }

        function buildMonthCalendarGridHTML(records, monthDate, getDatetimeFn, renderChipFn) {
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const firstDay = new Date(year, month, 1);
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const startWeekday = firstDay.getDay(); // 0 = Chủ Nhật
            const mondayOffset = (startWeekday + 6) % 7; // số ô trống đầu tháng để tuần bắt đầu từ Thứ 2

            const recordsByDate = {};
            records.forEach(r => {
                const dt = getDatetimeFn(r);
                if (!dt) return;
                const dateKey = getDateOnly(dt);
                if (!recordsByDate[dateKey]) recordsByDate[dateKey] = [];
                recordsByDate[dateKey].push(r);
            });

            // Lưu tạm dữ liệu + hàm render chip vào biến toàn cục để popup "Xem tất cả lịch trong ngày" dùng lại
            window.calendarDayRecordsMap = recordsByDate;
            window.calendarDayChipRenderer = renderChipFn;

            const todayKey = dateStringOffset(0);

            let cells = '';
            for (let i = 0; i < mondayOffset; i++) cells += `<div class="cal-cell cal-cell-empty"></div>`;
            for (let d = 1; d <= daysInMonth; d++) {
                const dateKey = `${year}-${pad2(month + 1)}-${pad2(d)}`;
                const isToday = dateKey === todayKey;
                const dayRecords = (recordsByDate[dateKey] || []).sort((a, b) => getDatetimeFn(a).localeCompare(getDatetimeFn(b)));
                // Luôn giữ TỔNG số dòng hiển thị (chip + nút "xem thêm" nếu có) KHÔNG VƯỢT QUÁ CAL_MAX_VISIBLE_CHIPS,
                // để chiều cao ô luôn cố định dù ngày đó có bao nhiêu lịch đi nữa.
                const hasOverflow = dayRecords.length > CAL_MAX_VISIBLE_CHIPS;
                const visibleCount = hasOverflow ? CAL_MAX_VISIBLE_CHIPS - 1 : dayRecords.length;
                const visibleRecords = dayRecords.slice(0, visibleCount);
                const hiddenCount = dayRecords.length - visibleRecords.length;
                cells += `
                    <div class="cal-cell ${isToday ? 'cal-cell-today' : ''}">
                        <div class="cal-cell-daynum">${d}${isToday ? ' <span class="cal-today-tag">Hôm nay</span>' : ''}</div>
                        <div class="cal-cell-items">
                            ${visibleRecords.map(r => renderChipFn(r)).join('')}
                            ${hiddenCount > 0 ? `<div class="cal-more-btn" onclick="openCalendarDayListModal('${dateKey}')">+${hiddenCount} lịch khác</div>` : ''}
                        </div>
                    </div>
                `;
            }

            return `
                <div class="cal-scroll-wrap">
                    <div class="cal-weekday-row">
                        <div>Thứ 2</div><div>Thứ 3</div><div>Thứ 4</div><div>Thứ 5</div><div>Thứ 6</div><div>Thứ 7</div><div>Chủ Nhật</div>
                    </div>
                    <div class="cal-grid">${cells}</div>
                </div>
            `;
        }

        // Trạng thái chế độ xem (danh sách/lịch tháng) - riêng cho từng module, chỉ tồn tại trong phiên làm việc
        let lichHenViewMode = 'list';
        let lichHenCalendarMonth = new Date();
        let calendarDetailLichHenId = null;

        function setLichHenViewMode(mode) {
            lichHenViewMode = mode;
            document.getElementById("btn-lh-view-list").classList.toggle("active", mode === 'list');
            document.getElementById("btn-lh-view-calendar").classList.toggle("active", mode === 'calendar');
            renderDatLichHenList();
        }

        function changeLichHenCalendarMonth(delta) {
            lichHenCalendarMonth = new Date(lichHenCalendarMonth.getFullYear(), lichHenCalendarMonth.getMonth() + delta, 1);
            renderDatLichHenList();
        }

        function renderDatLichHenList() {
            const container = document.getElementById("dat-lich-hen-container");
            const query = currentSearchQuery;

            // CHẾ ĐỘ XEM LỊCH THÁNG: hiển thị dạng lưới ngày trong tháng, bỏ qua phần chia hôm nay/2 ngày tới
            if (lichHenViewMode === 'calendar') {
                renderLichHenCalendarView();
                return;
            }

            let filtered = appData.datlichhen.filter(x =>
                x.customerName.toLowerCase().includes(query) || (x.phone || '').toLowerCase().includes(query)
            );

            // CHẾ ĐỘ LỌC NÂNG CAO: hiển thị 1 danh sách phẳng duy nhất theo đúng điều kiện đã nhập
            if (advancedLichHenFilter) {
                const { name, phone, dateFrom, dateTo } = advancedLichHenFilter;
                filtered = filtered.filter(x => {
                    if (name && !x.customerName.toLowerCase().includes(name)) return false;
                    if (phone && !(x.phone || '').toLowerCase().includes(phone)) return false;
                    const d = getDateOnly(x.datetime);
                    if (dateFrom && d < dateFrom) return false;
                    if (dateTo && d > dateTo) return false;
                    return true;
                });
                filtered.sort((a, b) => a.datetime.localeCompare(b.datetime));

                container.innerHTML = `
                    <div class="appointment-section">
                        <div class="appointment-section-title">
                            <span>🔍 Kết quả lọc nâng cao (${filtered.length} lịch hẹn)</span>
                            <button class="secondary" style="width:auto; margin:0; padding:5px 12px; font-size:12px;" onclick="resetAdvancedFilter()">✕ Bỏ lọc, về mặc định</button>
                        </div>
                        ${renderAppointmentGroup(filtered)}
                    </div>
                `;
                return;
            }

            // CHẾ ĐỘ MẶC ĐỊNH: chia 2 phần - Hôm nay / 2 ngày kế tiếp
            const todayStr = dateStringOffset(0);
            const day1Str = dateStringOffset(1);
            const day2Str = dateStringOffset(2);

            const todayList = filtered.filter(x => getDateOnly(x.datetime) === todayStr).sort((a, b) => a.datetime.localeCompare(b.datetime));
            const nextList = filtered.filter(x => getDateOnly(x.datetime) === day1Str || getDateOnly(x.datetime) === day2Str).sort((a, b) => a.datetime.localeCompare(b.datetime));

            container.innerHTML = `
                <div class="appointment-section">
                    <div class="appointment-section-title"><span>🗓️ Lịch hẹn hôm nay (${formatDateVN(todayStr)}) — ${todayList.length} lịch hẹn</span></div>
                    ${renderAppointmentGroup(todayList)}
                </div>
                <div class="appointment-section">
                    <div class="appointment-section-title"><span>📅 Lịch hẹn 2 ngày tới (${formatDateVN(day1Str)} - ${formatDateVN(day2Str)}) — ${nextList.length} lịch hẹn</span></div>
                    ${renderAppointmentGroup(nextList)}
                </div>
            `;
        }

        /* ================= CHẾ ĐỘ XEM LỊCH THÁNG - ĐẶT LỊCH HẸN TƯ VẤN ================= */
        function renderLichHenCalendarView() {
            const container = document.getElementById("dat-lich-hen-container");
            const query = currentSearchQuery;
            const filtered = appData.datlichhen.filter(x =>
                x.customerName.toLowerCase().includes(query) || (x.phone || '').toLowerCase().includes(query)
            );

            const monthLabel = `Tháng ${lichHenCalendarMonth.getMonth() + 1}/${lichHenCalendarMonth.getFullYear()}`;
            const gridHtml = buildMonthCalendarGridHTML(filtered, lichHenCalendarMonth, x => x.datetime, x => {
                const st = getStatusInfo(x.status);
                return `<div class="cal-chip" style="border-left-color:${st.border};" title="${escapeHtml(x.customerName)}" onclick="openLichHenDetailViewModal('${x.id}')">${escapeHtml(x.customerName)}</div>`;
            });

            container.innerHTML = `
                <div class="cal-header">
                    <button type="button" class="secondary" onclick="changeLichHenCalendarMonth(-1)">‹ Tháng trước</button>
                    <div class="cal-month-label">${monthLabel}</div>
                    <button type="button" class="secondary" onclick="changeLichHenCalendarMonth(1)">Tháng sau ›</button>
                </div>
                ${gridHtml}
            `;
        }

        // Mở popup xem chi tiết 1 lịch hẹn tư vấn (khi bấm vào chip trong lịch tháng)
        function openLichHenDetailViewModal(id) {
            closeModal('modal-calendar-day-list'); // Đóng popup "Xem tất cả trong ngày" nếu đang mở (an toàn dù không mở)
            const x = appData.datlichhen.find(r => r.id === id);
            if (!x) { alert("Lịch hẹn này không còn tồn tại (có thể đã bị xóa)."); return; }
            calendarDetailLichHenId = id;

            const nv = appData.nhanvien.find(n => n.id === x.staffId);
            const nk = appData.nguonkhach.find(n => n.id === x.sourceId);
            const st = getStatusInfo(x.status);
            const serviceIds = x.serviceIds || (x.serviceId ? [x.serviceId] : []);
            const serviceNames = serviceIds.map(sid => appData.dichvu.find(d => d.id === sid)).filter(Boolean).map(d => d.name);

            document.getElementById("lh-calendar-detail-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Khách hàng</span><span class="detail-info-value">${escapeHtml(x.customerName)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Số điện thoại</span><span class="detail-info-value">${escapeHtml(x.phone)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Thời gian hẹn</span><span class="detail-info-value">${formatDatetimeVN(x.datetime)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Nhân viên tư vấn</span><span class="detail-info-value">${nv ? escapeHtml(nv.name) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa phân công</span>'}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Nguồn khách hàng</span><span class="detail-info-value">${nk ? escapeHtml(nk.name) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa xác định</span>'}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Đánh giá khả năng</span><span>${renderKhaNangBadges(x)}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Dịch vụ tư vấn</span><span class="detail-info-value" style="font-weight:400;">${serviceNames.length > 0 ? escapeHtml(serviceNames.join(', ')) : '<span style="color:#ccc; font-style:italic">Chưa chọn dịch vụ</span>'}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Trạng thái</span><span><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></span></div>
            `;

            document.getElementById("btn-calendar-detail-delete-lh").style.display = isAdminUser() ? 'inline-block' : 'none';
            document.getElementById("modal-lich-hen-calendar-detail").style.display = "flex";
        }

        function calendarDetailEditLichHen() {
            const id = calendarDetailLichHenId;
            closeModal('modal-lich-hen-calendar-detail');
            openLichHenModal('edit', id);
        }
        function calendarDetailConsultResult() {
            const id = calendarDetailLichHenId;
            closeModal('modal-lich-hen-calendar-detail');
            openConsultationResultModal(id);
        }
        function calendarDetailDeleteLichHen() {
            const id = calendarDetailLichHenId;
            closeModal('modal-lich-hen-calendar-detail');
            deleteLichHen(id);
        }

        /* ================= LỌC NÂNG CAO ĐẶT LỊCH HẸN (CHỈ TỒN TẠI TRONG PHIÊN LÀM VIỆC) ================= */
        function openAdvancedFilterModal() {
            // Điền lại giá trị bộ lọc hiện tại (nếu có) để người dùng thấy đúng trạng thái đang áp dụng
            document.getElementById("filter-lh-name").value = advancedLichHenFilter?.name || "";
            document.getElementById("filter-lh-phone").value = advancedLichHenFilter?.phone || "";
            document.getElementById("filter-lh-from").value = advancedLichHenFilter?.dateFrom || "";
            document.getElementById("filter-lh-to").value = advancedLichHenFilter?.dateTo || "";
            document.getElementById("modal-loc-lich-hen").style.display = "flex";
        }

        function applyAdvancedFilter() {
            const name = document.getElementById("filter-lh-name").value.trim().toLowerCase();
            const phone = document.getElementById("filter-lh-phone").value.trim().toLowerCase();
            const dateFrom = document.getElementById("filter-lh-from").value;
            const dateTo = document.getElementById("filter-lh-to").value;

            if (dateFrom && dateTo && dateFrom > dateTo) {
                return alert("Khoảng ngày không hợp lệ: 'Từ ngày' phải trước hoặc bằng 'Đến ngày'!");
            }

            if (!name && !phone && !dateFrom && !dateTo) {
                advancedLichHenFilter = null; // Không nhập gì -> coi như không lọc
            } else {
                advancedLichHenFilter = { name, phone, dateFrom, dateTo };
            }
            closeModal('modal-loc-lich-hen');
            renderDatLichHenList();
        }

        function resetAdvancedFilter() {
            advancedLichHenFilter = null;
            document.getElementById("filter-lh-name").value = "";
            document.getElementById("filter-lh-phone").value = "";
            document.getElementById("filter-lh-from").value = "";
            document.getElementById("filter-lh-to").value = "";
            closeModal('modal-loc-lich-hen');
            renderDatLichHenList();
        }

        function openVanBanFilterModal() {
            const loaiSelect = document.getElementById("filter-vb-loai");
            loaiSelect.innerHTML = `<option value="">-- Tất cả loại văn bản --</option>` +
                appData.loaivanban.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');

            // Danh sách Nhóm loại văn bản CẤP 1 còn hoạt động - cấp 2, cấp 3 tự lọc/tự ẩn hiện theo lựa chọn
            // (dùng chung logic cascading với onVanBanFilterNhomLevelChange, giống hệt form Thêm/Sửa văn bản)
            const filterNhom1Select = document.getElementById("filter-vb-nhom-1");
            const activeLevel1GroupsFilter = appData.nhomloaivanban.filter(x => !x.parentId && !x.disabled);
            filterNhom1Select.innerHTML = `<option value="">-- Tất cả nhóm cấp 1 --</option>` +
                activeLevel1GroupsFilter.map(x => `<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');

            // Điền lại giá trị bộ lọc hiện tại (nếu có) để người dùng thấy đúng trạng thái đang áp dụng
            document.getElementById("filter-vb-code").value = advancedVanBanFilter?.code || "";
            loaiSelect.value = advancedVanBanFilter?.loaiVanBanId || "";
            document.getElementById("filter-vb-matraloidoc").value = advancedVanBanFilter?.matraloidoc || "";
            document.getElementById("filter-vb-sovanbangoc").value = advancedVanBanFilter?.sovanbangoc || "";
            document.getElementById("filter-vb-nguoiky").value = advancedVanBanFilter?.nguoiky || "";
            document.getElementById("filter-vb-from").value = advancedVanBanFilter?.dateFrom || "";
            document.getElementById("filter-vb-to").value = advancedVanBanFilter?.dateTo || "";
            document.getElementById("filter-vb-daphathanh-only").checked = advancedVanBanFilter?.daphathanhOnly || false;

            // Khôi phục lại đúng nhóm cấp 1/2/3 đã lọc trước đó (thêm lại vào select nếu nhóm đã bị vô hiệu
            // hóa sau khi lọc, để không âm thầm mất lựa chọn đang áp dụng khi mở lại modal)
            if (advancedVanBanFilter?.nhomCap1Id && !activeLevel1GroupsFilter.some(x => x.id === advancedVanBanFilter.nhomCap1Id)) {
                const outside = appData.nhomloaivanban.find(x => x.id === advancedVanBanFilter.nhomCap1Id);
                if (outside) filterNhom1Select.innerHTML += `<option value="${outside.id}">${escapeHtml(outside.name)} (Đã vô hiệu hóa)</option>`;
            }
            filterNhom1Select.value = advancedVanBanFilter?.nhomCap1Id || "";
            onVanBanFilterNhomLevelChange(1);

            if (advancedVanBanFilter?.nhomCap2Id) {
                const sel2 = document.getElementById("filter-vb-nhom-2");
                if (!Array.from(sel2.options).some(o => o.value === advancedVanBanFilter.nhomCap2Id)) {
                    const outside = appData.nhomloaivanban.find(x => x.id === advancedVanBanFilter.nhomCap2Id);
                    if (outside) sel2.innerHTML += `<option value="${outside.id}">${escapeHtml(outside.name)} (Đã vô hiệu hóa)</option>`;
                }
                sel2.value = advancedVanBanFilter.nhomCap2Id;
                document.getElementById("filter-vb-nhom-2-wrap").style.display = "block";
                onVanBanFilterNhomLevelChange(2);
            }

            if (advancedVanBanFilter?.nhomCap3Id) {
                const sel3 = document.getElementById("filter-vb-nhom-3");
                if (!Array.from(sel3.options).some(o => o.value === advancedVanBanFilter.nhomCap3Id)) {
                    const outside = appData.nhomloaivanban.find(x => x.id === advancedVanBanFilter.nhomCap3Id);
                    if (outside) sel3.innerHTML += `<option value="${outside.id}">${escapeHtml(outside.name)} (Đã vô hiệu hóa)</option>`;
                }
                sel3.value = advancedVanBanFilter.nhomCap3Id;
                document.getElementById("filter-vb-nhom-3-wrap").style.display = "block";
            }

            document.getElementById("modal-loc-van-ban").style.display = "flex";
        }

        function applyVanBanFilter() {
            const code = document.getElementById("filter-vb-code").value.trim().toLowerCase();
            const loaiVanBanId = document.getElementById("filter-vb-loai").value;
            const nhomCap1Id = document.getElementById("filter-vb-nhom-1").value || null;
            const nhomCap2Id = document.getElementById("filter-vb-nhom-2").value || null;
            const nhomCap3Id = document.getElementById("filter-vb-nhom-3").value || null;
            const matraloidoc = document.getElementById("filter-vb-matraloidoc").value.trim().toLowerCase();
            const sovanbangoc = document.getElementById("filter-vb-sovanbangoc").value.trim().toLowerCase();
            const nguoiky = document.getElementById("filter-vb-nguoiky").value.trim().toLowerCase();
            const dateFrom = document.getElementById("filter-vb-from").value;
            const dateTo = document.getElementById("filter-vb-to").value;
            const daphathanhOnly = document.getElementById("filter-vb-daphathanh-only").checked;

            if (dateFrom && dateTo && dateFrom > dateTo) {
                return alert("Khoảng ngày không hợp lệ: 'Từ ngày' phải trước hoặc bằng 'Đến ngày'!");
            }

            if (!code && !loaiVanBanId && !nhomCap1Id && !matraloidoc && !sovanbangoc && !nguoiky && !dateFrom && !dateTo && !daphathanhOnly) {
                advancedVanBanFilter = null; // Không nhập/chọn gì -> coi như không lọc
            } else {
                advancedVanBanFilter = { code, loaiVanBanId, nhomCap1Id, nhomCap2Id, nhomCap3Id, matraloidoc, sovanbangoc, nguoiky, dateFrom, dateTo, daphathanhOnly };
            }
            closeModal('modal-loc-van-ban');
            currentPage = 1;
            renderVanBanTable();
        }

        function resetVanBanFilter() {
            advancedVanBanFilter = null;
            document.getElementById("filter-vb-code").value = "";
            document.getElementById("filter-vb-loai").value = "";
            document.getElementById("filter-vb-nhom-1").value = "";
            document.getElementById("filter-vb-nhom-2").innerHTML = "";
            document.getElementById("filter-vb-nhom-3").innerHTML = "";
            document.getElementById("filter-vb-nhom-2-wrap").style.display = "none";
            document.getElementById("filter-vb-nhom-3-wrap").style.display = "none";
            document.getElementById("filter-vb-matraloidoc").value = "";
            document.getElementById("filter-vb-sovanbangoc").value = "";
            document.getElementById("filter-vb-nguoiky").value = "";
            document.getElementById("filter-vb-from").value = "";
            document.getElementById("filter-vb-to").value = "";
            document.getElementById("filter-vb-daphathanh-only").checked = false;
            closeModal('modal-loc-van-ban');
            currentPage = 1;
            renderVanBanTable();
        }

        function renderAppointmentGroup(list) {
            if (list.length === 0) {
                return `<div class="empty-state">Không có lịch hẹn nào trong khoảng thời gian này.</div>`;
            }
            return `
                <div class="table-responsive">
                    <table class="data-table data-table-compact">
                        <thead>
                            <tr>
                                <th>Khách Hàng</th>
                                <th class="col-nowrap">Số Điện Thoại</th>
                                <th class="col-nowrap">Thời Gian Hẹn</th>
                                <th>Dịch Vụ Tư Vấn</th>
                                <th class="col-nowrap">Nhân Viên Tư Vấn</th>
                                <th>Đánh Giá Khả Năng</th>
                                <th class="col-nowrap">Trạng Thái</th>
                                <th style="width: 130px; text-align: center;">Thao Tác</th>
                            </tr>
                        </thead>
                        <tbody>${list.map(x => renderAppointmentRow(x)).join('')}</tbody>
                    </table>
                </div>
            `;
        }

        // Hiển thị badge "Đánh giá khả năng" (Tư vấn / Phẫu thuật) - nhân viên tự đánh giá khả năng khách
        // hàng khi đến tư vấn, dùng thay cho cột Nguồn khách trên danh sách để tiện theo dõi tiềm năng.
        function renderKhaNangBadges(x) {
            const badges = [];
            if (x.khaNangTuVan) badges.push(`<span class="appointment-status-badge" style="background:#e3f2fd; color:#1565c0; border-color:#1565c0; margin:2px 4px 2px 0;">Tư vấn</span>`);
            if (x.khaNangPhauThuat) badges.push(`<span class="appointment-status-badge" style="background:#fdecea; color:#c62828; border-color:#c62828; margin:2px 4px 2px 0;">Phẫu thuật</span>`);
            return badges.length > 0 ? badges.join('') : '<span style="color:#ccc; font-style:italic">Chưa đánh giá</span>';
        }

        function renderAppointmentRow(x) {
            // Tương thích ngược: lịch hẹn cũ chỉ có 1 dịch vụ (serviceId), lịch hẹn mới có nhiều (serviceIds)
            const serviceIds = x.serviceIds || (x.serviceId ? [x.serviceId] : []);
            const serviceNames = serviceIds
                .map(id => appData.dichvu.find(d => d.id === id))
                .filter(Boolean)
                .map(d => d.name);
            const serviceDisplay = serviceNames.length > 0
                ? serviceNames.map(name => `<span class="appointment-status-badge" style="background:#eef2f7; color:var(--dark-brown); border-color:var(--gold); margin: 2px 4px 2px 0;">${name}</span>`).join('')
                : '<span style="color:#ccc; font-style:italic">Chưa chọn dịch vụ</span>';

            const nv = appData.nhanvien.find(n => n.id === x.staffId);
            const st = getStatusInfo(x.status);
            return `
                <tr>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.customerName}</td>
                    <td class="col-nowrap">${x.phone}</td>
                    <td class="col-nowrap">${formatDatetimeVN(x.datetime)}</td>
                    <td>${serviceDisplay}</td>
                    <td class="col-nowrap">${nv ? nv.name : '<span style="color:#ccc; font-style:italic">Chưa phân công</span>'}</td>
                    <td>${renderKhaNangBadges(x)}</td>
                    <td class="col-nowrap"><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openLichHenModal('edit', '${x.id}')">✏️ Sửa</button>
                                    <button type="button" onclick="openConsultationResultModal('${x.id}')">📊 Kết quả tư vấn</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteLichHen('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }

        // Chỉ lấy nhân viên thuộc vai trò có quyền "Lễ tân" - vai trò khác sẽ không hiển thị ở đây
        // Chỉ hiển thị nhân viên Lễ tân CÒN HOẠT ĐỘNG (chưa bị khóa) trong danh sách chọn để gán MỚI.
        // Nhân viên đã bị khóa vẫn được giữ nguyên tên hiển thị ở các bản ghi ĐÃ gán từ trước (không xóa dữ liệu),
        // chỉ đơn giản không xuất hiện trong danh sách để chọn cho các lượt gán mới sau khi bị khóa.
        function getLeTanStaffList() {
            return appData.nhanvien.filter(nv => {
                if (nv.locked) return false;
                const vt = appData.vaitro.find(v => v.id === nv.vaiTroId);
                return vt && vt.permissions && vt.permissions.letan;
            });
        }

        function openLichHenModal(mode, id = null) {
            const existingLh = mode === 'edit' ? appData.datlichhen.find(x => x.id === id) : null;
            // Tương thích ngược: lịch hẹn cũ chỉ có 1 dịch vụ (serviceId), lịch hẹn mới có nhiều (serviceIds)
            const selectedServiceIds = existingLh ? (existingLh.serviceIds || (existingLh.serviceId ? [existingLh.serviceId] : [])) : [];

            // Chỉ hiển thị dịch vụ CÒN HOẠT ĐỘNG để chọn MỚI; dịch vụ đã vô hiệu hóa nhưng ĐANG được chọn
            // sẵn trong lịch hẹn này thì vẫn hiển thị (kèm ghi chú) để không mất lựa chọn đã lưu trước đó.
            const visibleServices = appData.dichvu.filter(d => !d.disabled || selectedServiceIds.includes(d.id));
            const serviceListEl = document.getElementById("lh-service-list");
            serviceListEl.innerHTML = visibleServices.length > 0
                ? visibleServices.map(d => `
                    <label class="checkbox-list-item">
                        <input type="checkbox" class="lh-service-checkbox" value="${d.id}"> ${d.name}${d.disabled ? ' <span style="color:#999; font-style:italic; font-size:11px;">(Đã vô hiệu hóa)</span>' : ''}
                    </label>
                `).join('')
                : `<span class="checkbox-list-empty">Chưa có dịch vụ nào được cấu hình.</span>`;

            const staffSelect = document.getElementById("lh-staff");
            const leTanStaff = getLeTanStaffList();
            staffSelect.innerHTML = `<option value="">-- Chưa phân công --</option>` +
                (leTanStaff.length > 0
                    ? leTanStaff.map(nv => `<option value="${nv.id}">${nv.name}</option>`).join('')
                    : '');

            // Tương tự: nguồn khách hàng CÒN HOẠT ĐỘNG để chọn mới; nếu lịch hẹn đang sửa đã chọn 1 nguồn
            // đã bị vô hiệu hóa từ trước, vẫn thêm lại để không mất thông tin.
            const activeNguonKhach = appData.nguonkhach.filter(n => !n.disabled);
            const sourceSelect = document.getElementById("lh-source");
            sourceSelect.innerHTML = `<option value="">-- Chưa xác định --</option>` + activeNguonKhach.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
            if (existingLh && existingLh.sourceId && !activeNguonKhach.some(n => n.id === existingLh.sourceId)) {
                const nkOutside = appData.nguonkhach.find(n => n.id === existingLh.sourceId);
                if (nkOutside) sourceSelect.innerHTML += `<option value="${nkOutside.id}">${nkOutside.name} (Đã vô hiệu hóa)</option>`;
            }

            if (mode === 'add') {
                document.getElementById("title-modal-lh").innerText = "Đặt Lịch Hẹn Mới";
                document.getElementById("edit-lh-id").value = "";
                document.getElementById("edit-lh-version").value = "";
                document.getElementById("lh-customer-name").value = "";
                document.getElementById("lh-phone").value = "";
                setDatetimeInputValue('lh-datetime', '');
                document.getElementById("lh-staff").value = "";
                document.getElementById("lh-source").value = "";
                document.getElementById("lh-kha-nang-tu-van").checked = false;
                document.getElementById("lh-kha-nang-phau-thuat").checked = false;
                document.getElementById("lh-status").value = "pending";
            } else {
                document.getElementById("title-modal-lh").innerText = "Cập Nhật Lịch Hẹn";
                const lh = existingLh;
                document.getElementById("edit-lh-id").value = lh.id;
                // Ghi nhớ phiên bản (_v) của bản ghi TẠI THỜI ĐIỂM MỞ FORM, dùng để phát hiện xung đột lúc lưu
                document.getElementById("edit-lh-version").value = lh._v || 1;
                document.getElementById("lh-customer-name").value = lh.customerName;
                document.getElementById("lh-phone").value = lh.phone;
                setDatetimeInputValue('lh-datetime', lh.datetime);

                document.querySelectorAll(".lh-service-checkbox").forEach(cb => {
                    cb.checked = selectedServiceIds.includes(cb.value);
                });

                // Nếu nhân viên đang được gán đã đổi vai trò/không còn thuộc Lễ tân, vẫn thêm tạm vào để không mất dữ liệu
                if (lh.staffId && !leTanStaff.some(nv => nv.id === lh.staffId)) {
                    const staffOutside = appData.nhanvien.find(nv => nv.id === lh.staffId);
                    if (staffOutside) {
                        staffSelect.innerHTML += `<option value="${staffOutside.id}">${staffOutside.name} (Không khả dụng để chọn mới - đã đổi vai trò hoặc bị khóa)</option>`;
                    }
                }
                document.getElementById("lh-staff").value = lh.staffId || "";

                document.getElementById("lh-source").value = lh.sourceId || "";
                document.getElementById("lh-kha-nang-tu-van").checked = !!lh.khaNangTuVan;
                document.getElementById("lh-kha-nang-phau-thuat").checked = !!lh.khaNangPhauThuat;
                document.getElementById("lh-status").value = lh.status;
            }
            document.getElementById("modal-lich-hen").style.display = "flex";
        }

        async function saveLichHen() {
            const id = document.getElementById("edit-lh-id").value;
            const customerName = document.getElementById("lh-customer-name").value.trim();
            const phone = document.getElementById("lh-phone").value.trim();
            const datetime = getDatetimeInputValue('lh-datetime');
            const serviceIds = Array.from(document.querySelectorAll(".lh-service-checkbox:checked")).map(cb => cb.value);
            const staffId = document.getElementById("lh-staff").value;
            const sourceId = document.getElementById("lh-source").value;
            const khaNangTuVan = document.getElementById("lh-kha-nang-tu-van").checked;
            const khaNangPhauThuat = document.getElementById("lh-kha-nang-phau-thuat").checked;
            const status = document.getElementById("lh-status").value;
            const baseVersion = parseInt(document.getElementById("edit-lh-version").value || "1", 10);

            if (!customerName || !datetime) return alert("Vui lòng điền đủ Tên khách hàng và Thời gian hẹn!");

            const btn = document.getElementById("btn-save-lich-hen");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                if (!id) {
                    const newRecord = { id: generateUniqueId("lh"), customerName, phone, datetime, serviceIds, staffId, sourceId, khaNangTuVan, khaNangPhauThuat, status };
                    await saveLichHenSafely(newRecord, 'add', null);
                } else {
                    const updatedRecord = { id, customerName, phone, datetime, serviceIds, staffId, sourceId, khaNangTuVan, khaNangPhauThuat, status };
                    await saveLichHenSafely(updatedRecord, 'edit', baseVersion);
                }
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Lịch Hẹn"; }
            }
        }

        async function deleteLichHen(id) {
            if (!confirm("Bạn có chắc chắn muốn xóa lịch hẹn này?")) return;
            const record = appData.datlichhen.find(x => x.id === id);
            const baseVersion = record ? (record._v || 1) : 1;
            await saveLichHenSafely({ id }, 'delete', baseVersion);
        }

        /* ================= CƠ CHẾ CHỐNG XUNG ĐỘT DỮ LIỆU KHI NHIỀU NGƯỜI NHẬP LIỆU CÙNG LÚC =================
           Bản chất ứng dụng này KHÔNG có máy chủ trung tâm/cơ sở dữ liệu thật, chỉ có 1 file JSON dùng
           chung (qua File System Access API, ví dụ đặt trên ổ đĩa mạng) hoặc LocalStorage của trình duyệt.
           Nếu 2-3 người cùng mở app và thao tác gần như đồng thời, mỗi người đang cầm một "bản sao" dữ liệu
           trong bộ nhớ (appData) tại thời điểm họ tải trang - nếu chỉ ghi đè nguyên khối appData của mình
           lên file/LocalStorage, người lưu SAU sẽ vô tình xóa mất thay đổi của người lưu TRƯỚC mà không ai biết.

           Giải pháp: OPTIMISTIC CONCURRENCY CONTROL (khóa lạc quan) áp dụng theo TỪNG LỊCH HẸN:
           1. Mỗi lịch hẹn có số phiên bản riêng "_v", tăng dần mỗi lần bị sửa.
           2. Trước khi ghi, hệ thống ĐỌC LẠI dữ liệu MỚI NHẤT từ file thật (hoặc LocalStorage nếu không
              đồng bộ file) - KHÔNG dùng appData cũ đang có sẵn trong bộ nhớ - vì trong lúc form đang mở,
              người khác có thể đã lưu xong rồi.
           3. Chỉ hợp nhất (merge) đúng MỘT lịch hẹn vừa thao tác vào bản dữ liệu mới nhất đó, nên các
              lịch hẹn KHÁC mà người dùng khác vừa thêm/sửa/xóa trong lúc này vẫn được giữ nguyên vẹn.
           4. Nếu đúng lịch hẹn đang sửa lại bị người khác đổi trước đó (phiên bản không khớp) -> báo xung
              đột rõ ràng, hỏi người dùng muốn ghi đè hay giữ dữ liệu mới nhất, TUYỆT ĐỐI không âm thầm ghi đè. */

        async function readFreshAppDataSnapshot() {
            // CHỈ đọc từ FILE THẬT trên đĩa - đây là nguồn sự thật DUY NHẤT giữa nhiều máy/người dùng.
            // KHÔNG còn dự phòng qua LocalStorage nữa (đã bỏ), vì LocalStorage là bộ nhớ RIÊNG của từng máy/
            // trình duyệt, có thể chứa dữ liệu CŨ đã lỗi thời nếu máy khác đã lưu thay đổi mới hơn vào file -
            // nếu lỡ dùng LocalStorage làm dự phòng rồi ghi ngược lại file, sẽ vô tình "hồi sinh" lại dữ liệu
            // đã bị xóa/thay đổi ở máy khác (đây chính là lỗi đã được báo cáo và khắc phục).
            if (isElectronBridge) {
                if (!electronFilePath) return null;
                try {
                    const result = await window.electronFileAPI.readFile(electronFilePath);
                    if (!result.success) throw new Error(result.error || "Không đọc được file");
                    const snapshot = JSON.parse(result.content);
                    ensureAppDataDefaults(snapshot);
                    return snapshot;
                } catch (err) {
                    console.error("Không thể đọc file dữ liệu mới nhất từ đĩa (Electron):", err);
                    return null;
                }
            }
            if (!fileHandle) return null;
            try {
                const file = await fileHandle.getFile();
                const text = await file.text();
                const snapshot = JSON.parse(text);
                ensureAppDataDefaults(snapshot);
                return snapshot;
            } catch (err) {
                console.error("Không thể đọc file dữ liệu mới nhất từ đĩa:", err);
                return null;
            }
        }

        // Đọc dữ liệu mới nhất từ file để chuẩn bị ghi; nếu KHÔNG đọc được (file bị xóa/di chuyển/mất quyền),
        // BÁO LỖI RÕ RÀNG và trả về null - tuyệt đối không cho phép hàm gọi tự ý dùng lại appData cũ trong bộ
        // nhớ để ghi đè file, vì đó chính là nguyên nhân gây mất dữ liệu khi nhiều máy cùng dùng chung 1 file.
        async function readFreshAppDataSnapshotOrWarn() {
            const fresh = await readFreshAppDataSnapshot();
            if (!fresh) {
                logActivity('error', 'Kết nối file dữ liệu', 'Không đọc được file JSON', 'File có thể đã bị xóa, di chuyển, hoặc mất quyền truy cập.');
                alert("❌ Không thể đọc file dữ liệu để lưu — file có thể đã bị xóa, di chuyển, hoặc mất quyền truy cập.\n\nVui lòng tải lại trang (F5) và kết nối lại đúng file JSON trước khi thao tác tiếp, để tránh làm mất dữ liệu.");
            }
            return fresh;
        }

        async function persistAppDataSnapshot(snapshot) {
            appData = snapshot;
            await writeDataToFileHandle();
        }

        async function saveLichHenSafely(record, mode, baseVersion) {
            // Bước 1: Lấy bản dữ liệu MỚI NHẤT ngay trước khi ghi (không tin vào appData cũ trong bộ nhớ)
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return;

            if (mode === 'add') {
                // Tạo mới luôn dùng ID duy nhất (generateUniqueId) nên không thể trùng/đè lên lịch hẹn của người khác
                record._v = 1;
                fresh.datlichhen.push(record);
                logActivity('action', 'Đặt lịch hẹn tư vấn', 'Thêm mới', `${record.customerName} - ${record.phone}`, fresh);
            } else if (mode === 'delete') {
                const idx = fresh.datlichhen.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    alert("Lịch hẹn này đã được người khác xóa trước đó rồi, không cần thao tác gì thêm.");
                } else {
                    if ((fresh.datlichhen[idx]._v || 1) !== (baseVersion || 1)) {
                        const forceDelete = confirm("⚠️ Lịch hẹn này vừa được người khác cập nhật trong lúc bạn thao tác.\n\nBấm OK để VẪN XÓA lịch hẹn này, hoặc Cancel để hủy và xem dữ liệu mới nhất.");
                        if (!forceDelete) { await persistAppDataSnapshot(fresh); renderDatLichHenList(); return; }
                    }
                    logActivity('action', 'Đặt lịch hẹn tư vấn', 'Xóa', `${fresh.datlichhen[idx].customerName} - ${fresh.datlichhen[idx].phone}`, fresh);
                    fresh.datlichhen.splice(idx, 1);
                }
            } else { // edit
                const idx = fresh.datlichhen.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    const keepMine = confirm("⚠️ Lịch hẹn này đã bị người khác xóa trong lúc bạn đang chỉnh sửa.\n\nBấm OK để LƯU LẠI thông tin của bạn thành một lịch hẹn mới, hoặc Cancel để hủy thao tác.");
                    if (!keepMine) { await persistAppDataSnapshot(fresh); closeModal('modal-lich-hen'); renderDatLichHenList(); return; }
                    record._v = 1;
                    fresh.datlichhen.push(record);
                } else {
                    const current = fresh.datlichhen[idx];
                    if ((current._v || 1) !== (baseVersion || 1)) {
                        const overwrite = confirm(
                            "⚠️ Lịch hẹn này vừa được người khác cập nhật trong lúc bạn đang chỉnh sửa!\n\n" +
                            "Dữ liệu mới nhất trên hệ thống:\n" +
                            `- Khách hàng: ${current.customerName}\n- SĐT: ${current.phone}\n- Thời gian hẹn: ${formatDatetimeVN(current.datetime)}\n- Trạng thái: ${getStatusInfo(current.status).label}\n\n` +
                            "Bấm OK để GHI ĐÈ bằng thông tin bạn vừa nhập, hoặc Cancel để HỦY và giữ dữ liệu mới nhất."
                        );
                        if (!overwrite) { await persistAppDataSnapshot(fresh); closeModal('modal-lich-hen'); renderDatLichHenList(); return; }
                    }
                    record._v = (current._v || 1) + 1;
                    fresh.datlichhen[idx] = record;
                    logActivity('action', 'Đặt lịch hẹn tư vấn', 'Cập nhật', `${record.customerName} - ${record.phone}`, fresh);
                }
            }

            fresh._rev = (fresh._rev || 0) + 1;
            await persistAppDataSnapshot(fresh);
            closeModal('modal-lich-hen');
            renderDatLichHenList();
        }

        /* ================= KẾT QUẢ TƯ VẤN (RIÊNG CHO ĐẶT LỊCH HẸN TƯ VẤN) ================= */
        function openConsultationResultModal(id) {
            const lh = appData.datlichhen.find(x => x.id === id);
            if (!lh) { alert("Lịch hẹn này không còn tồn tại (có thể đã bị xóa)."); return; }

            document.getElementById("cr-lh-id").value = id;
            // Ghi nhớ phiên bản (_v) TẠI THỜI ĐIỂM MỞ FORM để phát hiện xung đột lúc lưu
            document.getElementById("cr-lh-version").value = lh._v || 1;
            document.getElementById("cr-result").value = lh.consultationResult || "";
            document.getElementById("cr-note").value = lh.consultationNote || "";
            document.getElementById("modal-consultation-result").style.display = "flex";
        }

        async function saveConsultationResult() {
            const id = document.getElementById("cr-lh-id").value;
            const baseVersion = parseInt(document.getElementById("cr-lh-version").value || "1", 10);
            const result = document.getElementById("cr-result").value;
            const note = document.getElementById("cr-note").value.trim();

            const btn = document.getElementById("btn-save-cr");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                // Đọc lại dữ liệu MỚI NHẤT trước khi ghi, giống cơ chế chống xung đột dùng chung toàn app
                const fresh = await readFreshAppDataSnapshotOrWarn();
                if (!fresh) return;
                const idx = fresh.datlichhen.findIndex(x => x.id === id);
                if (idx === -1) {
                    alert("Lịch hẹn này đã bị xóa trong lúc bạn đang thao tác, không thể lưu kết quả tư vấn.");
                    await persistAppDataSnapshot(fresh);
                    closeModal('modal-consultation-result');
                    renderDatLichHenList();
                    return;
                }

                const current = fresh.datlichhen[idx];
                if ((current._v || 1) !== (baseVersion || 1)) {
                    const overwrite = confirm("⚠️ Lịch hẹn này vừa được người khác cập nhật trong lúc bạn đang thao tác.\n\nBấm OK để VẪN LƯU kết quả tư vấn này, hoặc Cancel để hủy và xem dữ liệu mới nhất.");
                    if (!overwrite) {
                        await persistAppDataSnapshot(fresh);
                        closeModal('modal-consultation-result');
                        renderDatLichHenList();
                        return;
                    }
                }

                current.consultationResult = result;
                current.consultationNote = note;
                // Khi kết quả tư vấn là "Làm dịch vụ" -> khách hàng chắc chắn đã có mặt tư vấn trực tiếp,
                // tự động đổi trạng thái lịch hẹn sang "Đã đến tư vấn" luôn, đỡ phải vào sửa thủ công lại
                // trạng thái riêng - đồng thời đảm bảo biểu đồ/thẻ KPI "tỷ lệ chuyển đổi" tính đúng ngay.
                if (result === 'lam_dich_vu') {
                    current.status = 'arrived';
                    logActivity('action', 'Đặt lịch hẹn tư vấn', 'Tự động đổi trạng thái', `${current.customerName} - ${current.phone}: "Đã đến tư vấn" (do chọn kết quả tư vấn "Làm dịch vụ")`, fresh);
                }
                current._v = (current._v || 1) + 1;
                fresh._rev = (fresh._rev || 0) + 1;

                // Lưu tạm thông tin khách hàng để map sang form Đặt lịch phẫu thuật (nếu cần), vì sau khi
                // persistAppDataSnapshot() thì biến appData sẽ được thay bằng snapshot mới, không dùng current nữa
                const customerNameForSurgery = current.customerName;
                const phoneForSurgery = current.phone;
                const staffIdForSurgery = current.staffId;

                await persistAppDataSnapshot(fresh);
                closeModal('modal-consultation-result');
                renderDatLichHenList();

                // Nếu chọn "Làm dịch vụ" -> tự động mở popup Đặt lịch phẫu thuật, map sẵn Tên khách hàng + SĐT
                // + Nhân viên tư vấn (thường cùng 1 người tiếp tục chăm sóc khách, vẫn có thể tự đổi lại)
                if (result === 'lam_dich_vu') {
                    await openLichPhauThuatModalFromConsultation(customerNameForSurgery, phoneForSurgery, staffIdForSurgery);
                }
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Kết Quả"; }
            }
        }

        // Mở popup "Đặt lịch phẫu thuật" (y hệt giao diện + chức năng "+ Đặt Lịch Phẫu Thuật" bên Danh sách lịch phẫu thuật),
        // map sẵn Tên khách hàng + Số điện thoại từ lịch hẹn tư vấn vừa chọn "Làm dịch vụ".
        async function openLichPhauThuatModalFromConsultation(customerName, phone, staffId) {
            await openLichPhauThuatModal('add');
            document.getElementById("pt-customer-name").value = customerName || "";
            document.getElementById("pt-phone").value = phone || "";

            // Map luôn Nhân viên tư vấn từ lịch hẹn tư vấn sang Nhân viên tư vấn của lịch phẫu thuật
            // (thường là cùng 1 người tiếp tục chăm sóc khách), vẫn có thể tự đổi lại nếu cần.
            const staffSelect = document.getElementById("pt-staff");
            if (staffId) {
                if (!Array.from(staffSelect.options).some(opt => opt.value === staffId)) {
                    const staffOutside = appData.nhanvien.find(nv => nv.id === staffId);
                    if (staffOutside) {
                        staffSelect.innerHTML += `<option value="${staffOutside.id}">${staffOutside.name} (Không khả dụng để chọn mới - đã đổi vai trò hoặc bị khóa)</option>`;
                    }
                }
                staffSelect.value = staffId;
            }
        }

        // 5B. XỬ LÝ ĐẶT LỊCH TÁI KHÁM, THAY BĂNG, CẮT CHỈ (SUB-MENU CỦA NHẬP LIỆU LỄ TÂN)
        // Cấu trúc/logic giống hệt module Đặt lịch hẹn tư vấn ở trên, chỉ khác nguồn dữ liệu (appData.taikham)
        // và các id/tiền tố riêng (tk-) để không xung đột với module lịch hẹn tư vấn.
        let advancedTaiKhamFilter = null;

        // Trạng thái chế độ xem (danh sách/lịch tháng) - riêng cho module Tái khám, thay băng, cắt chỉ
        let taiKhamViewMode = 'list';
        let taiKhamCalendarMonth = new Date();
        let calendarDetailTaiKhamId = null;

        function setTaiKhamViewMode(mode) {
            taiKhamViewMode = mode;
            document.getElementById("btn-tk-view-list").classList.toggle("active", mode === 'list');
            document.getElementById("btn-tk-view-calendar").classList.toggle("active", mode === 'calendar');
            renderTaiKhamList();
        }

        function changeTaiKhamCalendarMonth(delta) {
            taiKhamCalendarMonth = new Date(taiKhamCalendarMonth.getFullYear(), taiKhamCalendarMonth.getMonth() + delta, 1);
            renderTaiKhamList();
        }

        function renderTaiKhamList() {
            const container = document.getElementById("tai-kham-container");
            const query = currentSearchQuery;

            // CHẾ ĐỘ XEM LỊCH THÁNG: hiển thị dạng lưới ngày trong tháng
            if (taiKhamViewMode === 'calendar') {
                renderTaiKhamCalendarView();
                return;
            }

            let filtered = appData.taikham.filter(x =>
                x.customerName.toLowerCase().includes(query) || (x.phone || '').toLowerCase().includes(query)
            );

            // CHẾ ĐỘ LỌC NÂNG CAO: hiển thị 1 danh sách phẳng duy nhất theo đúng điều kiện đã nhập
            if (advancedTaiKhamFilter) {
                const { name, phone, dateFrom, dateTo } = advancedTaiKhamFilter;
                filtered = filtered.filter(x => {
                    if (name && !x.customerName.toLowerCase().includes(name)) return false;
                    if (phone && !(x.phone || '').toLowerCase().includes(phone)) return false;
                    const d = getDateOnly(x.datetime);
                    if (dateFrom && d < dateFrom) return false;
                    if (dateTo && d > dateTo) return false;
                    return true;
                });
                filtered.sort((a, b) => a.datetime.localeCompare(b.datetime));

                container.innerHTML = `
                    <div class="appointment-section">
                        <div class="appointment-section-title">
                            <span>🔍 Kết quả lọc nâng cao (${filtered.length} lịch hẹn)</span>
                            <button class="secondary" style="width:auto; margin:0; padding:5px 12px; font-size:12px;" onclick="resetTaiKhamAdvancedFilter()">✕ Bỏ lọc, về mặc định</button>
                        </div>
                        ${renderTaiKhamGroup(filtered)}
                    </div>
                `;
                return;
            }

            // CHẾ ĐỘ MẶC ĐỊNH: chia 2 phần - Hôm nay / 2 ngày kế tiếp
            const todayStr = dateStringOffset(0);
            const day1Str = dateStringOffset(1);
            const day2Str = dateStringOffset(2);

            const todayList = filtered.filter(x => getDateOnly(x.datetime) === todayStr).sort((a, b) => a.datetime.localeCompare(b.datetime));
            const nextList = filtered.filter(x => getDateOnly(x.datetime) === day1Str || getDateOnly(x.datetime) === day2Str).sort((a, b) => a.datetime.localeCompare(b.datetime));

            container.innerHTML = `
                <div class="appointment-section">
                    <div class="appointment-section-title"><span>🗓️ Lịch hẹn hôm nay (${formatDateVN(todayStr)}) — ${todayList.length} lịch hẹn</span></div>
                    ${renderTaiKhamGroup(todayList)}
                </div>
                <div class="appointment-section">
                    <div class="appointment-section-title"><span>📅 Lịch hẹn 2 ngày tới (${formatDateVN(day1Str)} - ${formatDateVN(day2Str)}) — ${nextList.length} lịch hẹn</span></div>
                    ${renderTaiKhamGroup(nextList)}
                </div>
            `;
        }

        /* ================= CHẾ ĐỘ XEM LỊCH THÁNG - TÁI KHÁM, THAY BĂNG, CẮT CHỈ ================= */
        function renderTaiKhamCalendarView() {
            const container = document.getElementById("tai-kham-container");
            const query = currentSearchQuery;
            const filtered = appData.taikham.filter(x =>
                x.customerName.toLowerCase().includes(query) || (x.phone || '').toLowerCase().includes(query)
            );

            const monthLabel = `Tháng ${taiKhamCalendarMonth.getMonth() + 1}/${taiKhamCalendarMonth.getFullYear()}`;
            const gridHtml = buildMonthCalendarGridHTML(filtered, taiKhamCalendarMonth, x => x.datetime, x => {
                const st = getStatusInfo(x.status);
                return `<div class="cal-chip" style="border-left-color:${st.border};" title="${escapeHtml(x.customerName)}" onclick="openTaiKhamDetailViewModal('${x.id}')">${escapeHtml(x.customerName)}</div>`;
            });

            container.innerHTML = `
                <div class="cal-header">
                    <button type="button" class="secondary" onclick="changeTaiKhamCalendarMonth(-1)">‹ Tháng trước</button>
                    <div class="cal-month-label">${monthLabel}</div>
                    <button type="button" class="secondary" onclick="changeTaiKhamCalendarMonth(1)">Tháng sau ›</button>
                </div>
                ${gridHtml}
            `;
        }

        // Mở popup xem chi tiết 1 lịch tái khám/thay băng/cắt chỉ (khi bấm vào chip trong lịch tháng)
        function openTaiKhamDetailViewModal(id) {
            closeModal('modal-calendar-day-list');
            const x = appData.taikham.find(r => r.id === id);
            if (!x) { alert("Lịch hẹn này không còn tồn tại (có thể đã bị xóa)."); return; }
            calendarDetailTaiKhamId = id;

            const nv = appData.nhanvien.find(n => n.id === x.staffId);
            const st = getStatusInfo(x.status);
            const executionServices = x.executionServices || [];
            const serviceLabels = executionServices.map(v => getExecutionServiceLabel(v));

            document.getElementById("tk-calendar-detail-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Khách hàng</span><span class="detail-info-value">${escapeHtml(x.customerName)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Số điện thoại</span><span class="detail-info-value">${escapeHtml(x.phone)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Thời gian hẹn</span><span class="detail-info-value">${formatDatetimeVN(x.datetime)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Nhân viên tư vấn</span><span class="detail-info-value">${nv ? escapeHtml(nv.name) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa phân công</span>'}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Dịch vụ thực hiện</span><span class="detail-info-value" style="font-weight:400;">${serviceLabels.length > 0 ? escapeHtml(serviceLabels.join(', ')) : '<span style="color:#ccc; font-style:italic">Chưa chọn dịch vụ</span>'}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Trạng thái</span><span><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></span></div>
            `;

            document.getElementById("btn-calendar-detail-delete-tk").style.display = isAdminUser() ? 'inline-block' : 'none';
            document.getElementById("modal-tai-kham-calendar-detail").style.display = "flex";
        }

        function calendarDetailEditTaiKham() {
            const id = calendarDetailTaiKhamId;
            closeModal('modal-tai-kham-calendar-detail');
            openTaiKhamModal('edit', id);
        }
        function calendarDetailDeleteTaiKham() {
            const id = calendarDetailTaiKhamId;
            closeModal('modal-tai-kham-calendar-detail');
            deleteTaiKham(id);
        }

        /* ================= LỌC NÂNG CAO ĐẶT LỊCH TÁI KHÁM, THAY BĂNG, CẮT CHỈ (CHỈ TỒN TẠI TRONG PHIÊN LÀM VIỆC) ================= */
        function openTaiKhamAdvancedFilterModal() {
            document.getElementById("filter-tk-name").value = advancedTaiKhamFilter?.name || "";
            document.getElementById("filter-tk-phone").value = advancedTaiKhamFilter?.phone || "";
            document.getElementById("filter-tk-from").value = advancedTaiKhamFilter?.dateFrom || "";
            document.getElementById("filter-tk-to").value = advancedTaiKhamFilter?.dateTo || "";
            document.getElementById("modal-loc-tai-kham").style.display = "flex";
        }

        function applyTaiKhamAdvancedFilter() {
            const name = document.getElementById("filter-tk-name").value.trim().toLowerCase();
            const phone = document.getElementById("filter-tk-phone").value.trim().toLowerCase();
            const dateFrom = document.getElementById("filter-tk-from").value;
            const dateTo = document.getElementById("filter-tk-to").value;

            if (dateFrom && dateTo && dateFrom > dateTo) {
                return alert("Khoảng ngày không hợp lệ: 'Từ ngày' phải trước hoặc bằng 'Đến ngày'!");
            }

            if (!name && !phone && !dateFrom && !dateTo) {
                advancedTaiKhamFilter = null;
            } else {
                advancedTaiKhamFilter = { name, phone, dateFrom, dateTo };
            }
            closeModal('modal-loc-tai-kham');
            renderTaiKhamList();
        }

        function resetTaiKhamAdvancedFilter() {
            advancedTaiKhamFilter = null;
            document.getElementById("filter-tk-name").value = "";
            document.getElementById("filter-tk-phone").value = "";
            document.getElementById("filter-tk-from").value = "";
            document.getElementById("filter-tk-to").value = "";
            closeModal('modal-loc-tai-kham');
            renderTaiKhamList();
        }

        function renderTaiKhamGroup(list) {
            if (list.length === 0) {
                return `<div class="empty-state">Không có lịch hẹn nào trong khoảng thời gian này.</div>`;
            }
            return `
                <div class="table-responsive">
                    <table class="data-table data-table-compact">
                        <thead>
                            <tr>
                                <th>Khách Hàng</th>
                                <th class="col-nowrap">Số Điện Thoại</th>
                                <th class="col-nowrap">Thời Gian Hẹn</th>
                                <th>Dịch Vụ Thực Hiện</th>
                                <th class="col-nowrap">Nhân Viên Tư Vấn</th>
                                <th class="col-nowrap">Trạng Thái</th>
                                <th style="width: 120px; text-align: center;">Thao Tác</th>
                            </tr>
                        </thead>
                        <tbody>${list.map(x => renderTaiKhamRow(x)).join('')}</tbody>
                    </table>
                </div>
            `;
        }

        // Nhãn hiển thị tương ứng cho từng loại Dịch vụ thực hiện (Tái khám/Thay băng/Cắt chỉ)
        function getExecutionServiceLabel(value) {
            switch (value) {
                case 'tai_kham': return 'Tái khám';
                case 'thay_bang': return 'Thay băng';
                case 'cat_chi': return 'Cắt chỉ';
                default: return value;
            }
        }

        function renderTaiKhamRow(x) {
            const executionServices = x.executionServices || [];
            const serviceDisplay = executionServices.length > 0
                ? executionServices.map(v => `<span class="appointment-status-badge" style="background:#eef2f7; color:var(--dark-brown); border-color:var(--gold); margin: 2px 4px 2px 0;">${getExecutionServiceLabel(v)}</span>`).join('')
                : '<span style="color:#ccc; font-style:italic">Chưa chọn dịch vụ</span>';

            const nv = appData.nhanvien.find(n => n.id === x.staffId);
            const st = getStatusInfo(x.status);
            return `
                <tr>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.customerName}</td>
                    <td class="col-nowrap">${x.phone}</td>
                    <td class="col-nowrap">${formatDatetimeVN(x.datetime)}</td>
                    <td>${serviceDisplay}</td>
                    <td class="col-nowrap">${nv ? nv.name : '<span style="color:#ccc; font-style:italic">Chưa phân công</span>'}</td>
                    <td class="col-nowrap"><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <button class="secondary" onclick="openTaiKhamModal('edit', '${x.id}')">Sửa</button>
                            ${isAdminUser() ? `<button class="danger" onclick="deleteTaiKham('${x.id}')">Xóa</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }

        /* ================= KIỂM TRA TRÙNG SỐ ĐIỆN THOẠI KHI THÊM MỚI LỊCH TÁI KHÁM, THAY BĂNG, CẮT CHỈ ================= */
        function checkTkPhoneDuplicate() {
            // Chỉ kiểm tra khi đang THÊM MỚI (không áp dụng khi đang sửa 1 lịch đã có)
            const editingId = document.getElementById("edit-tk-id").value;
            if (editingId) return;

            const phone = document.getElementById("tk-phone").value.trim();
            if (!phone) return;

            const matches = appData.crmkhachhang.filter(c => c.phone === phone);
            if (matches.length === 0) return;

            const listEl = document.getElementById("tk-phone-duplicate-list");
            listEl.innerHTML = matches.map(ck => `
                <label class="checkbox-list-item" style="border:1px solid var(--border-color); border-radius:6px; padding:8px 10px;">
                    <input type="checkbox" class="tk-phone-dup-checkbox" value="${ck.id}" onclick="enforceSingleTkPhoneDupChoice(this)">
                    <span><strong>${escapeHtml(ck.customerName)}</strong> — Ngày sinh: ${ck.dob ? formatDateVN(ck.dob) : '<span style="color:#ccc; font-style:italic">Chưa cập nhật</span>'}</span>
                </label>
            `).join('');

            document.getElementById("modal-tk-phone-duplicate-warning").style.display = "flex";
        }

        // Đảm bảo chỉ chọn được 1 khách hàng tại 1 thời điểm (dù hiển thị dạng checkbox theo yêu cầu)
        function enforceSingleTkPhoneDupChoice(checkbox) {
            if (checkbox.checked) {
                document.querySelectorAll('.tk-phone-dup-checkbox').forEach(cb => { if (cb !== checkbox) cb.checked = false; });
            }
        }

        // Lấy Tên khách hàng của người đã chọn (checkbox) để điền vào trường Tên khách hàng đang mở
        function useTkPhoneDuplicateData() {
            const checked = document.querySelector('.tk-phone-dup-checkbox:checked');
            if (!checked) { alert("Vui lòng chọn 1 khách hàng trước khi bấm Lấy Dữ Liệu!"); return; }
            const ck = appData.crmkhachhang.find(c => c.id === checked.value);
            if (ck) document.getElementById("tk-customer-name").value = ck.customerName || "";
            closeModal('modal-tk-phone-duplicate-warning');
        }

        function openTaiKhamModal(mode, id = null) {
            const staffSelect = document.getElementById("tk-staff");
            const leTanStaff = getLeTanStaffList();
            staffSelect.innerHTML = `<option value="">-- Chưa phân công --</option>` +
                (leTanStaff.length > 0
                    ? leTanStaff.map(nv => `<option value="${nv.id}">${nv.name}</option>`).join('')
                    : '');

            if (mode === 'add') {
                document.getElementById("title-modal-tk").innerText = "Đặt Lịch Tái Khám, Thay Băng, Cắt Chỉ Mới";
                document.getElementById("edit-tk-id").value = "";
                document.getElementById("edit-tk-version").value = "";
                document.getElementById("tk-customer-name").value = "";
                document.getElementById("tk-phone").value = "";
                setDatetimeInputValue('tk-datetime', '');
                document.querySelectorAll(".tk-execution-service-checkbox").forEach(cb => cb.checked = false);
                document.getElementById("tk-staff").value = "";
                document.getElementById("tk-status").value = "pending";
            } else {
                document.getElementById("title-modal-tk").innerText = "Cập Nhật Lịch Tái Khám, Thay Băng, Cắt Chỉ";
                const tk = appData.taikham.find(x => x.id === id);
                document.getElementById("edit-tk-id").value = tk.id;
                document.getElementById("edit-tk-version").value = tk._v || 1;
                document.getElementById("tk-customer-name").value = tk.customerName;
                document.getElementById("tk-phone").value = tk.phone;
                setDatetimeInputValue('tk-datetime', tk.datetime);

                const selectedExecutionServices = tk.executionServices || [];
                document.querySelectorAll(".tk-execution-service-checkbox").forEach(cb => {
                    cb.checked = selectedExecutionServices.includes(cb.value);
                });

                if (tk.staffId && !leTanStaff.some(nv => nv.id === tk.staffId)) {
                    const staffOutside = appData.nhanvien.find(nv => nv.id === tk.staffId);
                    if (staffOutside) {
                        staffSelect.innerHTML += `<option value="${staffOutside.id}">${staffOutside.name} (Không khả dụng để chọn mới - đã đổi vai trò hoặc bị khóa)</option>`;
                    }
                }
                document.getElementById("tk-staff").value = tk.staffId || "";

                document.getElementById("tk-status").value = tk.status;
            }
            document.getElementById("modal-tai-kham").style.display = "flex";
        }

        async function saveTaiKham() {
            const id = document.getElementById("edit-tk-id").value;
            const customerName = document.getElementById("tk-customer-name").value.trim();
            const phone = document.getElementById("tk-phone").value.trim();
            const datetime = getDatetimeInputValue('tk-datetime');
            const executionServices = Array.from(document.querySelectorAll(".tk-execution-service-checkbox:checked")).map(cb => cb.value);
            const staffId = document.getElementById("tk-staff").value;
            const status = document.getElementById("tk-status").value;
            const baseVersion = parseInt(document.getElementById("edit-tk-version").value || "1", 10);

            if (!customerName || !phone || !datetime) return alert("Vui lòng điền đủ Tên khách hàng, Số điện thoại và Thời gian hẹn!");

            const btn = document.getElementById("btn-save-tai-kham");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                if (!id) {
                    const newRecord = { id: generateUniqueId("tk"), customerName, phone, datetime, executionServices, staffId, status };
                    await saveTaiKhamSafely(newRecord, 'add', null);
                } else {
                    const updatedRecord = { id, customerName, phone, datetime, executionServices, staffId, status };
                    await saveTaiKhamSafely(updatedRecord, 'edit', baseVersion);
                }
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Lịch Hẹn"; }
            }
        }

        async function deleteTaiKham(id) {
            if (!confirm("Bạn có chắc chắn muốn xóa lịch hẹn này?")) return;
            const record = appData.taikham.find(x => x.id === id);
            const baseVersion = record ? (record._v || 1) : 1;
            await saveTaiKhamSafely({ id }, 'delete', baseVersion);
        }

        /* Cơ chế chống xung đột dữ liệu (Optimistic Concurrency Control) - logic giống hệt saveLichHenSafely,
           chỉ khác thao tác trên appData.taikham và modal-tai-kham. */
        async function saveTaiKhamSafely(record, mode, baseVersion) {
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return;

            if (mode === 'add') {
                record._v = 1;
                fresh.taikham.push(record);
                logActivity('action', 'Tái khám/Thay băng/Cắt chỉ', 'Thêm mới', `${record.customerName} - ${record.phone}`, fresh);
            } else if (mode === 'delete') {
                const idx = fresh.taikham.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    alert("Lịch hẹn này đã được người khác xóa trước đó rồi, không cần thao tác gì thêm.");
                } else {
                    if ((fresh.taikham[idx]._v || 1) !== (baseVersion || 1)) {
                        const forceDelete = confirm("⚠️ Lịch hẹn này vừa được người khác cập nhật trong lúc bạn thao tác.\n\nBấm OK để VẪN XÓA lịch hẹn này, hoặc Cancel để hủy và xem dữ liệu mới nhất.");
                        if (!forceDelete) { await persistAppDataSnapshot(fresh); renderTaiKhamList(); return; }
                    }
                    logActivity('action', 'Tái khám/Thay băng/Cắt chỉ', 'Xóa', `${fresh.taikham[idx].customerName} - ${fresh.taikham[idx].phone}`, fresh);
                    fresh.taikham.splice(idx, 1);
                }
            } else { // edit
                const idx = fresh.taikham.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    const keepMine = confirm("⚠️ Lịch hẹn này đã bị người khác xóa trong lúc bạn đang chỉnh sửa.\n\nBấm OK để LƯU LẠI thông tin của bạn thành một lịch hẹn mới, hoặc Cancel để hủy thao tác.");
                    if (!keepMine) { await persistAppDataSnapshot(fresh); closeModal('modal-tai-kham'); renderTaiKhamList(); return; }
                    record._v = 1;
                    fresh.taikham.push(record);
                } else {
                    const current = fresh.taikham[idx];
                    if ((current._v || 1) !== (baseVersion || 1)) {
                        const overwrite = confirm(
                            "⚠️ Lịch hẹn này vừa được người khác cập nhật trong lúc bạn đang chỉnh sửa!\n\n" +
                            "Dữ liệu mới nhất trên hệ thống:\n" +
                            `- Khách hàng: ${current.customerName}\n- SĐT: ${current.phone}\n- Thời gian hẹn: ${formatDatetimeVN(current.datetime)}\n- Trạng thái: ${getStatusInfo(current.status).label}\n\n` +
                            "Bấm OK để GHI ĐÈ bằng thông tin bạn vừa nhập, hoặc Cancel để HỦY và giữ dữ liệu mới nhất."
                        );
                        if (!overwrite) { await persistAppDataSnapshot(fresh); closeModal('modal-tai-kham'); renderTaiKhamList(); return; }
                    }
                    record._v = (current._v || 1) + 1;
                    fresh.taikham[idx] = record;
                    logActivity('action', 'Tái khám/Thay băng/Cắt chỉ', 'Cập nhật', `${record.customerName} - ${record.phone}`, fresh);
                }
            }

            fresh._rev = (fresh._rev || 0) + 1;
            await persistAppDataSnapshot(fresh);
            closeModal('modal-tai-kham');
            renderTaiKhamList();
        }

        // 5C. XỬ LÝ DANH SÁCH LỊCH PHẪU THUẬT (SUB-MENU CỦA NHẬP LIỆU LỄ TÂN)
        // Tương tự module Đặt lịch hẹn tư vấn nhưng KHÔNG có "Kết quả tư vấn", trường gọn hơn,
        // và có thêm Mã khách hàng tự động phát sinh theo cấu hình ở phần Quản trị hệ thống.
        let advancedLichPhauThuatFilter = null;

        // Nhãn + màu badge riêng cho trạng thái Lịch phẫu thuật
        function getSurgeryStatusInfo(status) {
            switch (status) {
                case 'expected': return { label: 'Dự kiến', bg: '#e3f2fd', color: '#1565c0', border: '#1565c0' };
                case 'done': return { label: 'Đã thực hiện', bg: '#e8f5e9', color: '#2e7d32', border: '#2e7d32' };
                case 'postponed': return { label: 'Hoãn lịch', bg: '#fff3e0', color: '#e65100', border: '#e65100' };
                case 'cancelled': return { label: 'Hủy', bg: '#fdecea', color: '#c62828', border: '#c62828' };
                case 'pending':
                default: return { label: 'Đã xác nhận - Chờ thực hiện', bg: '#fff8e1', color: '#a67c00', border: '#f0d774' };
            }
        }

        // Trạng thái chế độ xem (danh sách/lịch tháng) - riêng cho module Lịch phẫu thuật
        let phauThuatViewMode = 'list';
        let phauThuatCalendarMonth = new Date();
        let calendarDetailPhauThuatId = null;

        function setLichPhauThuatViewMode(mode) {
            phauThuatViewMode = mode;
            document.getElementById("btn-pt-view-list").classList.toggle("active", mode === 'list');
            document.getElementById("btn-pt-view-calendar").classList.toggle("active", mode === 'calendar');
            renderLichPhauThuatList();
        }

        function changePhauThuatCalendarMonth(delta) {
            phauThuatCalendarMonth = new Date(phauThuatCalendarMonth.getFullYear(), phauThuatCalendarMonth.getMonth() + delta, 1);
            renderLichPhauThuatList();
        }

        function renderLichPhauThuatList() {
            const container = document.getElementById("lich-phau-thuat-container");
            const query = currentSearchQuery;

            // CHẾ ĐỘ XEM LỊCH THÁNG: hiển thị dạng lưới ngày trong tháng
            if (phauThuatViewMode === 'calendar') {
                renderLichPhauThuatCalendarView();
                return;
            }

            let filtered = appData.lichphauthuat.filter(x =>
                x.customerName.toLowerCase().includes(query) ||
                (x.phone || '').toLowerCase().includes(query) ||
                (x.code || '').toLowerCase().includes(query)
            );

            if (advancedLichPhauThuatFilter) {
                const { name, phone, dateFrom, dateTo } = advancedLichPhauThuatFilter;
                filtered = filtered.filter(x => {
                    if (name && !x.customerName.toLowerCase().includes(name)) return false;
                    if (phone && !(x.phone || '').toLowerCase().includes(phone)) return false;
                    const d = getDateOnly(x.datetime);
                    if (dateFrom && d < dateFrom) return false;
                    if (dateTo && d > dateTo) return false;
                    return true;
                });
                filtered.sort((a, b) => a.datetime.localeCompare(b.datetime));

                container.innerHTML = `
                    <div class="appointment-section">
                        <div class="appointment-section-title">
                            <span>🔍 Kết quả lọc nâng cao (${filtered.length} lịch phẫu thuật)</span>
                            <button class="secondary" style="width:auto; margin:0; padding:5px 12px; font-size:12px;" onclick="resetLichPhauThuatAdvancedFilter()">✕ Bỏ lọc, về mặc định</button>
                        </div>
                        ${renderLichPhauThuatGroup(filtered)}
                    </div>
                `;
                return;
            }

            const todayStr = dateStringOffset(0);
            const day1Str = dateStringOffset(1);
            const day2Str = dateStringOffset(2);

            const todayList = filtered.filter(x => getDateOnly(x.datetime) === todayStr).sort((a, b) => a.datetime.localeCompare(b.datetime));
            const nextList = filtered.filter(x => getDateOnly(x.datetime) === day1Str || getDateOnly(x.datetime) === day2Str).sort((a, b) => a.datetime.localeCompare(b.datetime));

            container.innerHTML = `
                <div class="appointment-section">
                    <div class="appointment-section-title"><span>🗓️ Lịch phẫu thuật hôm nay (${formatDateVN(todayStr)}) — ${todayList.length} lịch</span></div>
                    ${renderLichPhauThuatGroup(todayList)}
                </div>
                <div class="appointment-section">
                    <div class="appointment-section-title"><span>📅 Lịch phẫu thuật 2 ngày tới (${formatDateVN(day1Str)} - ${formatDateVN(day2Str)}) — ${nextList.length} lịch</span></div>
                    ${renderLichPhauThuatGroup(nextList)}
                </div>
            `;
        }

        /* ================= CHẾ ĐỘ XEM LỊCH THÁNG - LỊCH PHẪU THUẬT ================= */
        function renderLichPhauThuatCalendarView() {
            const container = document.getElementById("lich-phau-thuat-container");
            const query = currentSearchQuery;
            const filtered = appData.lichphauthuat.filter(x =>
                x.customerName.toLowerCase().includes(query) ||
                (x.phone || '').toLowerCase().includes(query) ||
                (x.code || '').toLowerCase().includes(query)
            );

            const monthLabel = `Tháng ${phauThuatCalendarMonth.getMonth() + 1}/${phauThuatCalendarMonth.getFullYear()}`;
            const gridHtml = buildMonthCalendarGridHTML(filtered, phauThuatCalendarMonth, x => x.datetime, x => {
                const st = getSurgeryStatusInfo(x.status);
                return `<div class="cal-chip" style="border-left-color:${st.border};" title="${escapeHtml(x.customerName)}" onclick="openLichPhauThuatDetailViewModal('${x.id}')">${escapeHtml(x.code || '')} - ${escapeHtml(x.customerName)}</div>`;
            });

            container.innerHTML = `
                <div class="cal-header">
                    <button type="button" class="secondary" onclick="changePhauThuatCalendarMonth(-1)">‹ Tháng trước</button>
                    <div class="cal-month-label">${monthLabel}</div>
                    <button type="button" class="secondary" onclick="changePhauThuatCalendarMonth(1)">Tháng sau ›</button>
                </div>
                ${gridHtml}
            `;
        }

        // Mở popup xem chi tiết 1 lịch phẫu thuật (khi bấm vào chip trong lịch tháng)
        function openLichPhauThuatDetailViewModal(id) {
            closeModal('modal-calendar-day-list');
            const x = appData.lichphauthuat.find(r => r.id === id);
            if (!x) { alert("Lịch phẫu thuật này không còn tồn tại (có thể đã bị xóa)."); return; }
            calendarDetailPhauThuatId = id;

            const nv = appData.nhanvien.find(n => n.id === x.staffId);
            const st = getSurgeryStatusInfo(x.status);
            const serviceNames = (x.serviceIds || []).map(sid => appData.dichvu.find(d => d.id === sid)).filter(Boolean).map(d => d.name);

            document.getElementById("pt-calendar-detail-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Mã khách hàng</span><span class="detail-info-value">${escapeHtml(x.code || '')}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Khách hàng</span><span class="detail-info-value">${escapeHtml(x.customerName)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Số điện thoại</span><span class="detail-info-value">${escapeHtml(x.phone)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Thời gian phẫu thuật</span><span class="detail-info-value">${formatDatetimeVN(x.datetime)}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Nhân viên tư vấn</span><span class="detail-info-value">${nv ? escapeHtml(nv.name) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa phân công</span>'}</span></div>
                <div class="detail-info-item full-width"><span class="detail-info-label">Dịch vụ phẫu thuật</span><span class="detail-info-value" style="font-weight:400;">${serviceNames.length > 0 ? escapeHtml(serviceNames.join(', ')) : '<span style="color:#ccc; font-style:italic">Chưa chọn dịch vụ</span>'}</span></div>
                ${x.serviceDesc ? `<div class="detail-info-item full-width"><span class="detail-info-label">Mô tả dịch vụ</span><span class="detail-info-value" style="font-weight:400;">${escapeHtml(x.serviceDesc)}</span></div>` : ''}
                <div class="detail-info-item full-width"><span class="detail-info-label">Trạng thái</span><span><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></span></div>
            `;

            document.getElementById("btn-calendar-detail-delete-pt").style.display = isAdminUser() ? 'inline-block' : 'none';
            document.getElementById("modal-lich-phau-thuat-calendar-detail").style.display = "flex";
        }

        function calendarDetailEditLichPhauThuat() {
            const id = calendarDetailPhauThuatId;
            closeModal('modal-lich-phau-thuat-calendar-detail');
            openLichPhauThuatModal('edit', id);
        }
        function calendarDetailDeleteLichPhauThuat() {
            const id = calendarDetailPhauThuatId;
            closeModal('modal-lich-phau-thuat-calendar-detail');
            deleteLichPhauThuat(id);
        }

        function openLichPhauThuatAdvancedFilterModal() {
            document.getElementById("filter-pt-name").value = advancedLichPhauThuatFilter?.name || "";
            document.getElementById("filter-pt-phone").value = advancedLichPhauThuatFilter?.phone || "";
            document.getElementById("filter-pt-from").value = advancedLichPhauThuatFilter?.dateFrom || "";
            document.getElementById("filter-pt-to").value = advancedLichPhauThuatFilter?.dateTo || "";
            document.getElementById("modal-loc-lich-phau-thuat").style.display = "flex";
        }

        function applyLichPhauThuatAdvancedFilter() {
            const name = document.getElementById("filter-pt-name").value.trim().toLowerCase();
            const phone = document.getElementById("filter-pt-phone").value.trim().toLowerCase();
            const dateFrom = document.getElementById("filter-pt-from").value;
            const dateTo = document.getElementById("filter-pt-to").value;

            if (dateFrom && dateTo && dateFrom > dateTo) {
                return alert("Khoảng ngày không hợp lệ: 'Từ ngày' phải trước hoặc bằng 'Đến ngày'!");
            }

            if (!name && !phone && !dateFrom && !dateTo) {
                advancedLichPhauThuatFilter = null;
            } else {
                advancedLichPhauThuatFilter = { name, phone, dateFrom, dateTo };
            }
            closeModal('modal-loc-lich-phau-thuat');
            renderLichPhauThuatList();
        }

        function resetLichPhauThuatAdvancedFilter() {
            advancedLichPhauThuatFilter = null;
            document.getElementById("filter-pt-name").value = "";
            document.getElementById("filter-pt-phone").value = "";
            document.getElementById("filter-pt-from").value = "";
            document.getElementById("filter-pt-to").value = "";
            closeModal('modal-loc-lich-phau-thuat');
            renderLichPhauThuatList();
        }

        function renderLichPhauThuatGroup(list) {
            if (list.length === 0) {
                return `<div class="empty-state">Không có lịch phẫu thuật nào trong khoảng thời gian này.</div>`;
            }
            return `
                <div class="table-responsive">
                    <table class="data-table data-table-compact">
                        <thead>
                            <tr>
                                <th class="col-nowrap">Mã KH</th>
                                <th>Khách Hàng</th>
                                <th class="col-nowrap">Số Điện Thoại</th>
                                <th class="col-nowrap">Thời Gian Phẫu Thuật</th>
                                <th class="col-nowrap">Nhân Viên Tư Vấn</th>
                                <th class="col-nowrap">Trạng Thái</th>
                                <th style="width: 130px; text-align: center;">Thao Tác</th>
                            </tr>
                        </thead>
                        <tbody>${list.map(x => renderLichPhauThuatRow(x)).join('')}</tbody>
                    </table>
                </div>
            `;
        }

        function renderLichPhauThuatRow(x) {
            const nv = appData.nhanvien.find(n => n.id === x.staffId);
            const st = getSurgeryStatusInfo(x.status);
            return `
                <tr>
                    <td class="col-nowrap"><strong>${x.code || ''}</strong></td>
                    <td style="font-weight:600; color:var(--dark-brown);">${x.customerName}</td>
                    <td class="col-nowrap">${x.phone}</td>
                    <td class="col-nowrap">${formatDatetimeVN(x.datetime)}</td>
                    <td class="col-nowrap">${nv ? nv.name : '<span style="color:#ccc; font-style:italic">Chưa phân công</span>'}</td>
                    <td class="col-nowrap"><span class="appointment-status-badge" style="background:${st.bg}; color:${st.color}; border-color:${st.border};">${st.label}</span></td>
                    <td style="text-align:center;">
                        <div class="table-actions">
                            <div class="action-dropdown">
                                <button class="secondary" onclick="toggleActionDropdown(this)">Hành động ▾</button>
                                <div class="action-dropdown-menu">
                                    <button type="button" onclick="openLichPhauThuatModal('edit', '${x.id}')">✏️ Sửa</button>
                                    ${isAdminUser() ? `<button type="button" class="danger-option" onclick="deleteLichPhauThuat('${x.id}')">🗑️ Xóa</button>` : ''}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }

        /* ================= KIỂM TRA TRÙNG CCCD KHI THÊM MỚI LỊCH PHẪU THUẬT ================= */
        // Ghi nhớ khách hàng CRM đã khớp CCCD (nếu có) - dùng để: (1) điền dữ liệu khi bấm "Sử Dụng Dữ Liệu",
        // (2) cho phép saveLichPhauThuat() bỏ qua cảnh báo "trùng mã" khi cố ý dùng lại đúng mã của khách hàng cũ.
        let cccdDuplicateMatchedCk = null;

        function checkPtCccdDuplicate() {
            // Chỉ kiểm tra khi đang THÊM MỚI (không áp dụng khi đang sửa 1 lịch phẫu thuật đã có)
            const editingId = document.getElementById("edit-pt-id").value;
            if (editingId) return;

            const cccd = document.getElementById("pt-cccd").value.trim();
            if (!cccd) return;

            const matched = appData.crmkhachhang.find(c => c.cccd === cccd);
            if (!matched) { cccdDuplicateMatchedCk = null; return; }

            cccdDuplicateMatchedCk = matched;
            document.getElementById("cccd-duplicate-info").innerHTML = `
                <div class="detail-info-item"><span class="detail-info-label">Tên khách hàng</span><span class="detail-info-value">${escapeHtml(matched.customerName)}</span></div>
                <div class="detail-info-item"><span class="detail-info-label">Ngày sinh</span><span class="detail-info-value">${matched.dob ? formatDateVN(matched.dob) : '<span style="color:#ccc; font-weight:400; font-style:italic">Chưa cập nhật</span>'}</span></div>
            `;
            document.getElementById("modal-cccd-duplicate-warning").style.display = "flex";
        }

        // Điền toàn bộ thông tin đã có của khách hàng (khớp CCCD) vào form Đặt lịch phẫu thuật đang mở,
        // kể cả Mã khách hàng - để khi lưu, hệ thống nhận diện đúng là CÙNG 1 khách hàng (không tạo dòng CRM mới)
        function useCccdDuplicateData() {
            if (!cccdDuplicateMatchedCk) { closeModal('modal-cccd-duplicate-warning'); return; }
            const ck = cccdDuplicateMatchedCk;
            document.getElementById("pt-code").value = ck.code || document.getElementById("pt-code").value;
            document.getElementById("pt-customer-name").value = ck.customerName || "";
            document.getElementById("pt-phone").value = ck.phone || "";
            document.getElementById("pt-address").value = ck.address || "";
            document.getElementById("pt-dob").value = ck.dob || "";
            document.getElementById("pt-gender").value = ck.gender || "";
            document.getElementById("pt-cccd").value = ck.cccd || "";
            document.getElementById("pt-cccd-issue-place").value = ck.cccdIssuePlace || "";
            document.getElementById("pt-cccd-issue-date").value = ck.cccdIssueDate || "";
            closeModal('modal-cccd-duplicate-warning');
        }

        async function openLichPhauThuatModal(mode, id = null) {
            const existingPt = mode === 'edit' ? appData.lichphauthuat.find(x => x.id === id) : null;
            const selectedServiceIds = existingPt ? (existingPt.serviceIds || []) : [];

            const staffSelect = document.getElementById("pt-staff");
            const leTanStaff = getLeTanStaffList();
            staffSelect.innerHTML = `<option value="">-- Chưa phân công --</option>` +
                (leTanStaff.length > 0
                    ? leTanStaff.map(nv => `<option value="${nv.id}">${nv.name}</option>`).join('')
                    : '');

            // Chỉ hiển thị dịch vụ CÒN HOẠT ĐỘNG để chọn MỚI; dịch vụ đã vô hiệu hóa nhưng ĐANG được chọn
            // sẵn trong lịch phẫu thuật này thì vẫn hiển thị (kèm ghi chú) để không mất lựa chọn đã lưu trước đó.
            const visibleServices = appData.dichvu.filter(d => !d.disabled || selectedServiceIds.includes(d.id));
            const serviceListEl = document.getElementById("pt-service-list");
            serviceListEl.innerHTML = visibleServices.length > 0
                ? visibleServices.map(d => `
                    <label class="checkbox-list-item">
                        <input type="checkbox" class="pt-service-checkbox" value="${d.id}"> ${d.name}${d.disabled ? ' <span style="color:#999; font-style:italic; font-size:11px;">(Đã vô hiệu hóa)</span>' : ''}
                    </label>
                `).join('')
                : `<span class="checkbox-list-empty">Chưa có dịch vụ nào được cấu hình.</span>`;

            if (mode === 'add') {
                cccdDuplicateMatchedCk = null; // Reset trạng thái cảnh báo trùng CCCD từ lần mở trước (nếu có)
                document.getElementById("title-modal-pt").innerText = "Đặt Lịch Phẫu Thuật Mới";
                document.getElementById("edit-pt-id").value = "";
                document.getElementById("edit-pt-version").value = "";
                document.getElementById("pt-code").value = "Đang tạo mã...";
                document.getElementById("pt-customer-name").value = "";
                document.getElementById("pt-phone").value = "";
                document.getElementById("pt-address").value = "";
                document.getElementById("pt-dob").value = "";
                document.getElementById("pt-gender").value = "";
                document.getElementById("pt-cccd").value = "";
                document.getElementById("pt-cccd").disabled = false; // Thêm mới -> luôn cho phép nhập CCCD
                document.getElementById("pt-cccd").title = "";
                document.getElementById("pt-cccd-issue-place").value = "";
                document.getElementById("pt-cccd-issue-date").value = "";
                document.querySelectorAll(".pt-service-checkbox").forEach(cb => cb.checked = false);
                document.getElementById("pt-service-desc").value = "";
                setDatetimeInputValue('pt-datetime', '');
                document.getElementById("pt-staff").value = "";
                document.getElementById("pt-status").value = "pending";
                document.getElementById("pt-hoptac").checked = false;
                document.getElementById("modal-lich-phau-thuat").style.display = "flex";
                // Xem trước mã khách hàng tiếp theo (KHÔNG tăng bộ đếm) - có thể tự chỉnh sửa lại sau khi
                // đã điền. Bộ đếm chỉ thực sự tăng khi bấm Lưu, tránh "nhảy cóc" số nếu hủy form giữa chừng.
                const autoCode = await previewSurgeryCode();
                document.getElementById("pt-code").value = autoCode || "Lỗi tạo mã - vui lòng tải lại trang";
            } else {
                document.getElementById("title-modal-pt").innerText = "Cập Nhật Lịch Phẫu Thuật";
                const pt = existingPt;
                document.getElementById("edit-pt-id").value = pt.id;
                document.getElementById("edit-pt-version").value = pt._v || 1;
                document.getElementById("pt-code").value = pt.code || "";

                // Đồng bộ các trường thông tin khách hàng TỪ Danh sách khách hàng (CRM) - đây mới là nguồn
                // dữ liệu "chuẩn" luôn được cập nhật mới nhất (có thể đã được sửa qua nhiều kênh khác nhau
                // sau khi lịch phẫu thuật này được tạo). Nếu chỉ lấy từ chính bản ghi lịch phẫu thuật (dữ
                // liệu lưu tại thời điểm tạo/sửa lần trước) sẽ dễ bị CŨ hơn Danh sách khách hàng, khiến
                // người dùng vô tình nhập/lưu đè lại dữ liệu sai lệch. Nếu không tìm thấy khách hàng tương
                // ứng trong CRM (trường hợp hiếm, ví dụ đã bị xóa khỏi CRM) thì dùng tạm dữ liệu có sẵn
                // trên chính bản ghi lịch phẫu thuật như trước đây.
                const ckSynced = appData.crmkhachhang.find(c => c.code === pt.code);
                const src = ckSynced || pt;
                document.getElementById("pt-customer-name").value = src.customerName || pt.customerName || "";
                document.getElementById("pt-phone").value = src.phone || "";
                document.getElementById("pt-address").value = src.address || "";
                document.getElementById("pt-dob").value = src.dob || "";
                document.getElementById("pt-gender").value = src.gender || "";
                document.getElementById("pt-cccd").value = src.cccd || "";
                document.getElementById("pt-cccd").disabled = false; // Cho phép chỉnh sửa CCCD bình thường như mọi trường khác
                document.getElementById("pt-cccd").title = "";
                document.getElementById("pt-cccd-issue-place").value = src.cccdIssuePlace || "";
                document.getElementById("pt-cccd-issue-date").value = src.cccdIssueDate || "";

                document.querySelectorAll(".pt-service-checkbox").forEach(cb => {
                    cb.checked = selectedServiceIds.includes(cb.value);
                });
                document.getElementById("pt-service-desc").value = pt.serviceDesc || "";

                setDatetimeInputValue('pt-datetime', pt.datetime);

                if (pt.staffId && !leTanStaff.some(nv => nv.id === pt.staffId)) {
                    const staffOutside = appData.nhanvien.find(nv => nv.id === pt.staffId);
                    if (staffOutside) {
                        staffSelect.innerHTML += `<option value="${staffOutside.id}">${staffOutside.name} (Không khả dụng để chọn mới - đã đổi vai trò hoặc bị khóa)</option>`;
                    }
                }
                document.getElementById("pt-staff").value = pt.staffId || "";
                document.getElementById("pt-status").value = pt.status;
                document.getElementById("pt-hoptac").checked = pt.hoptac || false;
                document.getElementById("modal-lich-phau-thuat").style.display = "flex";
            }
        }

        // Lưu tạm bản ghi đang chờ xác nhận "Hoãn lịch" (chỉ dùng trong khoảng thời gian popup xác nhận đang mở)
        let pendingPostponeSurgeryAction = null;

        async function saveLichPhauThuat() {
            const id = document.getElementById("edit-pt-id").value;
            const code = document.getElementById("pt-code").value.trim().toUpperCase();
            const customerName = document.getElementById("pt-customer-name").value.trim();
            const phone = document.getElementById("pt-phone").value.trim();
            const address = document.getElementById("pt-address").value.trim();
            const dob = document.getElementById("pt-dob").value;
            const gender = document.getElementById("pt-gender").value;
            const cccd = document.getElementById("pt-cccd").value.trim();
            const cccdIssuePlace = document.getElementById("pt-cccd-issue-place").value.trim();
            const cccdIssueDate = document.getElementById("pt-cccd-issue-date").value;
            const serviceIds = Array.from(document.querySelectorAll(".pt-service-checkbox:checked")).map(cb => cb.value);
            const serviceDesc = document.getElementById("pt-service-desc").value.trim();
            const datetime = getDatetimeInputValue('pt-datetime');
            const staffId = document.getElementById("pt-staff").value;
            const status = document.getElementById("pt-status").value;
            const hoptac = document.getElementById("pt-hoptac").checked;
            const baseVersion = parseInt(document.getElementById("edit-pt-version").value || "1", 10);

            if (!code || !customerName) return alert("Vui lòng điền đủ Mã khách hàng và Tên khách hàng!");
            if (cccd && !/^[A-Za-z0-9]+$/.test(cccd)) return alert("CCCD/Passport chỉ được chứa chữ và số, không chứa khoảng trắng hay ký tự đặc biệt!");

            // Cảnh báo nếu mã này đã có lịch sử phẫu thuật của một khách hàng KHÁC đã bị xóa (tránh nhận nhầm lịch sử)
            if (!id && hasOrphanedHistoryForCode(code)) {
                if (!confirmOrphanedCodeReuse(code)) return;
            }

            // KHÔNG kiểm tra trùng Mã khách hàng nữa: 1 khách hàng có thể thực hiện NHIỀU LẦN phẫu thuật
            // theo thời gian (mỗi lần là 1 bản ghi lịch phẫu thuật riêng, nhưng dùng chung 1 Mã khách hàng
            // để nhận diện đúng là cùng 1 người) - tương tự cách "Đặt lịch tái khám, thay băng, cắt chỉ"
            // vốn đã cho phép 1 khách hàng có nhiều lần hẹn mà không cần mã riêng biệt.
            const record = { id: id || generateUniqueId("pt"), code, customerName, phone, address, dob, gender, cccd, cccdIssuePlace, cccdIssueDate, serviceIds, serviceDesc, datetime, staffId, status, hoptac };
            const mode = id ? 'edit' : 'add';
            const baseVersionArg = id ? baseVersion : null;

            // Chuyển sang trạng thái "Hoãn lịch": bắt buộc xác nhận lại trước khi lưu, vì sau khi hoãn sẽ
            // KHÔNG thể đổi lịch sang ngày khác nữa (muốn mổ lại thì phải tạo 1 lịch phẫu thuật MỚI).
            if (status === 'postponed') {
                pendingPostponeSurgeryAction = { record, mode, baseVersionArg };
                document.getElementById("modal-confirm-postpone-surgery").style.display = "flex";
                return;
            }

            await proceedSaveLichPhauThuat(record, mode, baseVersionArg);
        }

        // Người dùng bấm "×" ở popup xác nhận Hoãn lịch -> hủy thao tác, KHÔNG lưu, giữ nguyên form đang mở
        function cancelPostponeSurgeryConfirm() {
            pendingPostponeSurgeryAction = null;
            document.getElementById("modal-confirm-postpone-surgery").style.display = "none";
        }

        // Người dùng bấm "Đồng ý" ở popup xác nhận Hoãn lịch -> tiến hành lưu thật sự
        async function confirmPostponeSurgeryAndSave() {
            document.getElementById("modal-confirm-postpone-surgery").style.display = "none";
            if (!pendingPostponeSurgeryAction) return;
            const { record, mode, baseVersionArg } = pendingPostponeSurgeryAction;
            pendingPostponeSurgeryAction = null;
            await proceedSaveLichPhauThuat(record, mode, baseVersionArg);
        }

        // Phần lưu thực sự (tách riêng để cả luồng lưu bình thường và luồng sau khi xác nhận Hoãn lịch đều dùng chung)
        async function proceedSaveLichPhauThuat(record, mode, baseVersionArg) {
            const btn = document.getElementById("btn-save-pt");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }
            try {
                await saveLichPhauThuatSafely(record, mode, baseVersionArg);
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Lịch Phẫu Thuật"; }
            }
        }

        async function deleteLichPhauThuat(id) {
            if (!confirm("Bạn có chắc chắn muốn xóa lịch phẫu thuật này?")) return;
            const record = appData.lichphauthuat.find(x => x.id === id);
            const baseVersion = record ? (record._v || 1) : 1;
            await saveLichPhauThuatSafely({ id }, 'delete', baseVersion);
        }

        /* Cơ chế chống xung đột dữ liệu (Optimistic Concurrency Control) - logic giống hệt saveLichHenSafely/saveTaiKhamSafely */
        // Đồng bộ 1 dòng dữ liệu tương ứng vào Danh sách khách hàng CRM (lấy tất cả các trường, TRỪ Trạng thái).
        // Khớp theo Mã khách hàng: nếu đã tồn tại thì cập nhật đè, chưa có thì tạo mới - Địa chỉ (nếu có sẵn) được giữ nguyên.
        function upsertCrmKhachHangFromSurgery(fresh, pt) {
            if (!fresh.crmkhachhang) fresh.crmkhachhang = [];
            const syncedFields = {
                code: pt.code,
                customerName: pt.customerName,
                phone: pt.phone,
                address: pt.address || '',
                dob: pt.dob || '',
                gender: pt.gender || '',
                cccd: pt.cccd || '',
                cccdIssuePlace: pt.cccdIssuePlace || '',
                cccdIssueDate: pt.cccdIssueDate || '',
                serviceDesc: pt.serviceDesc || '',
                surgeryDatetime: pt.datetime || '',
                staffId: pt.staffId || '',
                hoptac: pt.hoptac || false
            };
            const ck = fresh.crmkhachhang.find(c => c.code === pt.code);
            if (ck) {
                Object.assign(ck, syncedFields);
                delete ck.surgeryServiceIds; // Bỏ hẳn trường Dịch vụ phẫu thuật cũ (không còn đồng bộ) nếu đã có từ trước
                ck._v = (ck._v || 1) + 1;
            } else {
                fresh.crmkhachhang.push({ id: generateUniqueId("ck"), ...syncedFields, _v: 1 });
            }
        }

        // Xóa khách hàng tương ứng khỏi Danh sách khách hàng CRM (dùng khi lịch phẫu thuật chuyển sang trạng thái Hủy)
        function removeCrmKhachHangByCode(fresh, code) {
            if (!fresh.crmkhachhang) return;
            fresh.crmkhachhang = fresh.crmkhachhang.filter(c => c.code !== code);
        }

        // Quyết định đồng bộ hay xóa khách hàng bên CRM tùy theo trạng thái lịch phẫu thuật:
        // - "Hủy" -> tự động xóa khách hàng tương ứng khỏi Danh sách khách hàng
        // - "Dự kiến" -> lịch CHƯA được xác nhận chắc chắn, KHÔNG tự động tạo/cập nhật khách hàng trong CRM
        //   (tránh tạo khách hàng "ảo" trong Danh sách khách hàng chỉ vì mới đang dự kiến, chưa chắc diễn ra).
        //   Nếu khách hàng này đã tồn tại sẵn trong CRM từ trước (do lịch từng ở trạng thái khác) thì vẫn
        //   giữ nguyên, không xóa - chỉ đơn giản là không tạo mới/không cập nhật thêm trong lúc này.
        // - Các trạng thái khác (Đã xác nhận - Chờ thực hiện, Đã thực hiện, Hoãn lịch) -> đồng bộ như bình thường
        function syncCrmKhachHangForSurgery(fresh, record) {
            if (record.status === 'cancelled') {
                removeCrmKhachHangByCode(fresh, record.code);
            } else if (record.status === 'expected') {
                return;
            } else {
                upsertCrmKhachHangFromSurgery(fresh, record);
            }
        }

        async function saveLichPhauThuatSafely(record, mode, baseVersion) {
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return;

            if (mode === 'add') {
                record._v = 1;
                fresh.lichphauthuat.push(record);
                syncCrmKhachHangForSurgery(fresh, record);
                logActivity('action', 'Lịch phẫu thuật', 'Thêm mới', `${record.code} - ${record.customerName}`, fresh);
                // Chỉ THỰC SỰ tăng bộ đếm mã khi lưu thành công, tránh lãng phí số nếu người dùng mở form
                // rồi hủy mà không lưu gì (lỗi đã được báo cáo và khắc phục).
                if (!fresh.surgeryCodeConfig) fresh.surgeryCodeConfig = { prefix: "PT", digits: 4, nextNumber: 1 };
                fresh.surgeryCodeConfig.nextNumber = (fresh.surgeryCodeConfig.nextNumber || 1) + 1;
            } else if (mode === 'delete') {
                const idx = fresh.lichphauthuat.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    alert("Lịch phẫu thuật này đã được người khác xóa trước đó rồi, không cần thao tác gì thêm.");
                } else {
                    if ((fresh.lichphauthuat[idx]._v || 1) !== (baseVersion || 1)) {
                        const forceDelete = confirm("⚠️ Lịch phẫu thuật này vừa được người khác cập nhật trong lúc bạn thao tác.\n\nBấm OK để VẪN XÓA, hoặc Cancel để hủy và xem dữ liệu mới nhất.");
                        if (!forceDelete) { await persistAppDataSnapshot(fresh); renderLichPhauThuatList(); return; }
                    }
                    logActivity('action', 'Lịch phẫu thuật', 'Xóa', `${fresh.lichphauthuat[idx].code} - ${fresh.lichphauthuat[idx].customerName}`, fresh);
                    fresh.lichphauthuat.splice(idx, 1);
                }
            } else { // edit
                const idx = fresh.lichphauthuat.findIndex(x => x.id === record.id);
                if (idx === -1) {
                    const keepMine = confirm("⚠️ Lịch phẫu thuật này đã bị người khác xóa trong lúc bạn đang chỉnh sửa.\n\nBấm OK để LƯU LẠI thông tin của bạn thành một lịch mới, hoặc Cancel để hủy thao tác.");
                    if (!keepMine) { await persistAppDataSnapshot(fresh); closeModal('modal-lich-phau-thuat'); renderLichPhauThuatList(); return; }
                    record._v = 1;
                    fresh.lichphauthuat.push(record);
                    syncCrmKhachHangForSurgery(fresh, record);
                } else {
                    const current = fresh.lichphauthuat[idx];
                    if ((current._v || 1) !== (baseVersion || 1)) {
                        const overwrite = confirm(
                            "⚠️ Lịch phẫu thuật này vừa được người khác cập nhật trong lúc bạn đang chỉnh sửa!\n\n" +
                            "Dữ liệu mới nhất trên hệ thống:\n" +
                            `- Mã KH: ${current.code}\n- Khách hàng: ${current.customerName}\n- SĐT: ${current.phone}\n- Thời gian: ${formatDatetimeVN(current.datetime)}\n- Trạng thái: ${getSurgeryStatusInfo(current.status).label}\n\n` +
                            "Bấm OK để GHI ĐÈ bằng thông tin bạn vừa nhập, hoặc Cancel để HỦY và giữ dữ liệu mới nhất."
                        );
                        if (!overwrite) { await persistAppDataSnapshot(fresh); closeModal('modal-lich-phau-thuat'); renderLichPhauThuatList(); return; }
                    }
                    record._v = (current._v || 1) + 1;
                    fresh.lichphauthuat[idx] = record;
                    syncCrmKhachHangForSurgery(fresh, record);
                    logActivity('action', 'Lịch phẫu thuật', 'Cập nhật', `${record.code} - ${record.customerName}`, fresh);
                }
            }

            fresh._rev = (fresh._rev || 0) + 1;
            await persistAppDataSnapshot(fresh);
            closeModal('modal-lich-phau-thuat');
            renderLichPhauThuatList();
        }

        /* ================= CẤU HÌNH MÃ PHÁT SINH (MÃ KHÁCH HÀNG - LỊCH PHẪU THUẬT) ================= */
        // Tạo mã tiếp theo theo cấu hình (Tiền tố + số đệm 0), rồi TĂNG & LƯU NGAY bộ đếm dùng cơ chế
        // đọc-mới-nhất-rồi-ghi để giảm thiểu rủi ro trùng mã khi nhiều người cùng thêm mới gần như đồng thời.
        // CHỈ XEM TRƯỚC mã khách hàng tiếp theo - KHÔNG tăng bộ đếm, KHÔNG ghi vào file. Việc tăng bộ đếm
        // THẬT SỰ chỉ diễn ra khi LƯU THÀNH CÔNG (xem saveLichPhauThuatSafely/saveCrmKhachHangSafely), để
        // tránh tình trạng mở form rồi hủy (không lưu gì) mà mã vẫn bị "nhảy cóc" mất một số.
        async function previewSurgeryCode() {
            const fresh = await readFreshAppDataSnapshotOrWarn();
            if (!fresh) return '';
            const cfg = fresh.surgeryCodeConfig || { prefix: "PT", digits: 4, nextNumber: 1 };
            return `${cfg.prefix}${String(cfg.nextNumber).padStart(Math.max(cfg.digits || 4, 1), '0')}`;
        }

        function renderSurgeryCodeConfigForm() {
            const cfg = appData.surgeryCodeConfig || { prefix: "PT", digits: 4, nextNumber: 1 };
            document.getElementById("cfg-code-prefix").value = cfg.prefix;
            document.getElementById("cfg-code-digits").value = cfg.digits;
            document.getElementById("cfg-code-next").value = cfg.nextNumber;
            updateSurgeryCodePreview();
        }

        function updateSurgeryCodePreview() {
            const prefix = (document.getElementById("cfg-code-prefix").value || "").trim().toUpperCase();
            const digits = parseInt(document.getElementById("cfg-code-digits").value || "4", 10);
            const next = parseInt(document.getElementById("cfg-code-next").value || "1", 10);
            const preview = `${prefix}${String(next).padStart(Math.max(digits, 1), '0')}`;
            document.getElementById("cfg-code-preview").innerText = preview;
        }

        async function saveSurgeryCodeConfig() {
            const prefix = document.getElementById("cfg-code-prefix").value.trim().toUpperCase();
            const digits = parseInt(document.getElementById("cfg-code-digits").value || "4", 10);
            const nextNumber = parseInt(document.getElementById("cfg-code-next").value || "1", 10);

            if (!prefix) return alert("Vui lòng nhập Tiền tố mã!");
            if (!digits || digits < 1) return alert("Số chữ số đệm phải lớn hơn 0!");
            if (!nextNumber || nextNumber < 1) return alert("Số thứ tự tiếp theo phải lớn hơn 0!");

            const btn = document.getElementById("btn-save-code-config");
            if (btn) { btn.disabled = true; btn.innerText = "Đang lưu..."; }

            try {
                const fresh = await readFreshAppDataSnapshotOrWarn();
                if (!fresh) return;
                fresh.surgeryCodeConfig = { prefix, digits, nextNumber };
                fresh._rev = (fresh._rev || 0) + 1;
                await persistAppDataSnapshot(fresh);
                alert("Đã lưu cấu hình mã phát sinh thành công!");
                renderSurgeryCodeConfigForm();
            } finally {
                if (btn) { btn.disabled = false; btn.innerText = "Lưu Cấu Hình"; }
            }
        }

        /* HÀM VẼ NÚT PHÂN TRANG CHUNG */
        function renderPaginationButtons(container, totalPages) {
            let html = `<button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>&laquo; Trước</button>`;
            for (let i = 1; i <= totalPages; i++) {
                html += `<button onclick="changePage(${i})" class="${currentPage === i ? 'active-page' : ''}">${i}</button>`;
            }
            html += `<button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Sau &raquo;</button>`;
            container.innerHTML = html;
        }
        /* ================= HỖ TRỢ NHẤN ENTER ĐỂ THỰC THI ================= */
        /* Gắn sự kiện Enter cho danh sách input theo id, gọi hàm xử lý tương ứng.
           Dùng cho các input/select text thông thường - KHÔNG dùng cho textarea
           (vì Enter trong textarea cần giữ nguyên chức năng xuống dòng). */
        function bindEnterKeySubmit(inputIds, submitFn) {
            inputIds.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        submitFn();
                    }
                });
            });
        }

        // Màn hình đăng nhập: Enter ở tên đăng nhập hoặc mật khẩu -> Đăng nhập ngay
        // Khởi tạo sẵn danh sách Giờ (00-23)/Phút (00-59) cho toàn bộ control ngày giờ tự xây trong app
        document.querySelectorAll('.dt-hour-select').forEach(el => el.innerHTML = buildHourOptions());
        document.querySelectorAll('.dt-minute-select').forEach(el => el.innerHTML = buildMinuteOptions());

        /* ================= ĐĂNG KÝ CẤU HÌNH XUẤT/NHẬP EXCEL CHO TỪNG DANH MỤC =================
           - Danh mục dùng Tier-1 (saveToLocalStorage): Nhân viên, Vai trò, Phòng ban, Dịch vụ, Nguồn khách
             hàng, Nhóm loại văn bản, Loại văn bản - importRow thao tác trực tiếp trên appData (đã là dữ
             liệu "sống"), CHỈ gọi saveToLocalStorage() DUY NHẤT 1 LẦN sau khi xử lý xong cả loạt dòng
             (afterImport) - tránh phải đọc/ghi file liên tục cho từng dòng, vừa nhanh vừa an toàn.
           - Danh mục dùng Tier-2 (đọc-mới-nhất-rồi-ghi, có kiểm soát xung đột): CME, Văn bản - đọc dữ liệu
             mới nhất từ file DUY NHẤT 1 LẦN trước khi xử lý cả loạt dòng (usesFreshSnapshot:true), rồi ghi
             lại DUY NHẤT 1 LẦN sau khi xử lý xong - đúng cơ chế an toàn đã áp dụng nhất quán trong toàn app. */

        registerImportExportConfig('nhanvien', {
            label: 'Nhân viên', fileNamePrefix: 'Danh_sach_nhan_vien',
            headers: ['Mã NV', 'Họ Và Tên', 'Phòng Ban', 'Vai Trò', 'Tên Đăng Nhập', 'Mật Khẩu'],
            templateExample: ['NV001', 'Nguyễn Văn A', 'Tên phòng ban đã có trong hệ thống', 'Tên vai trò đã có trong hệ thống', 'nva', '123456'],
            exportRows: () => appData.nhanvien.map(x => [
                x.code, x.name,
                appData.phongban.find(p => p.id === x.phongBanId)?.name || '',
                appData.vaitro.find(v => v.id === x.vaiTroId)?.name || '',
                x.username, x.password
            ]),
            importRow: (cells) => {
                const [code, name, phongBanName, vaiTroName, username, password] = cells;
                if (!code?.trim() || !name?.trim() || !username?.trim() || !password?.trim()) return { success: false, error: 'Thiếu Mã NV / Họ tên / Tên đăng nhập / Mật khẩu' };
                const codeUp = code.trim().toUpperCase();
                if (username.trim().toLowerCase() === 'admin') return { success: false, error: 'Không được đặt tên đăng nhập là "admin"' };
                if (appData.nhanvien.some(x => x.code === codeUp)) return { success: false, error: `Mã NV "${codeUp}" đã tồn tại` };
                if (appData.nhanvien.some(x => x.username === username.trim())) return { success: false, error: `Tên đăng nhập "${username.trim()}" đã tồn tại` };
                const pb = phongBanName?.trim() ? appData.phongban.find(x => x.name.toLowerCase() === phongBanName.trim().toLowerCase()) : null;
                const vt = vaiTroName?.trim() ? appData.vaitro.find(x => x.name.toLowerCase() === vaiTroName.trim().toLowerCase()) : null;
                appData.nhanvien.push({ id: generateUniqueId("nv"), code: codeUp, name: name.trim(), phongBanId: pb ? pb.id : '', vaiTroId: vt ? vt.id : '', username: username.trim(), password: password.trim() });
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderNhanVienTable(); }
        });

        registerImportExportConfig('vaitro', {
            label: 'Vai trò', fileNamePrefix: 'Danh_sach_vai_tro',
            headers: ['Mã Vai Trò', 'Tên Vai Trò'],
            templateExample: ['VT001', 'Nhân viên Lễ Tân'],
            exportRows: () => appData.vaitro.map(x => [x.code, x.name]),
            importRow: (cells) => {
                const [code, name] = cells;
                if (!code?.trim() || !name?.trim()) return { success: false, error: 'Thiếu Mã vai trò hoặc Tên vai trò' };
                const codeUp = code.trim().toUpperCase();
                if (appData.vaitro.some(x => x.code === codeUp)) return { success: false, error: `Mã vai trò "${codeUp}" đã tồn tại` };
                // Quyền hạn mặc định TẮT hết khi nhập từ Excel (CSV không đủ chỗ để tick từng quyền) -
                // vào "Quản lý vai trò & Quyền" để chỉnh sửa/tích chọn quyền cụ thể sau khi nhập
                appData.vaitro.push({
                    id: generateUniqueId("vt"), code: codeUp, name: name.trim(), disabled: false,
                    permissions: { letan: false, kythuat: false, crmdata: false, crmkhachhang: false, taikham: false, lichphauthuat: false, dashboardletan: false, quanlyvanban: false, quanlycme: false }
                });
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderVaiTroTable(); }
        });

        registerImportExportConfig('phongban', {
            label: 'Phòng ban', fileNamePrefix: 'Danh_sach_phong_ban',
            headers: ['Mã Phòng Ban', 'Tên Phòng Ban', 'Mô Tả'],
            templateExample: ['PB001', 'Phòng Lễ Tân', 'Phụ trách tiếp đón và tư vấn khách hàng'],
            exportRows: () => appData.phongban.map(x => [x.code, x.name, x.desc || '']),
            importRow: (cells) => {
                const [code, name, desc] = cells;
                if (!code?.trim() || !name?.trim()) return { success: false, error: 'Thiếu Mã phòng ban hoặc Tên phòng ban' };
                const codeUp = code.trim().toUpperCase();
                if (appData.phongban.some(x => x.code === codeUp)) return { success: false, error: `Mã phòng ban "${codeUp}" đã tồn tại` };
                appData.phongban.push({ id: generateUniqueId("pb"), code: codeUp, name: name.trim(), desc: (desc || '').trim(), disabled: false });
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderPhongBanTable(); }
        });

        registerImportExportConfig('dichvu', {
            label: 'Dịch vụ', fileNamePrefix: 'Danh_sach_dich_vu',
            headers: ['Mã Dịch Vụ', 'Tên Dịch Vụ', 'Nhóm Dịch Vụ', 'Mô Tả'],
            templateExample: ['DV001', 'Nâng mũi', 'Dịch vụ thẩm mỹ', 'Nâng mũi bằng sụn sinh học'],
            exportRows: () => appData.dichvu.map(x => [x.code, x.name, x.group || '', x.desc || '']),
            importRow: (cells) => {
                const [code, name, group, desc] = cells;
                if (!code?.trim() || !name?.trim()) return { success: false, error: 'Thiếu Mã dịch vụ hoặc Tên dịch vụ' };
                const codeUp = code.trim().toUpperCase();
                if (appData.dichvu.some(x => x.code === codeUp)) return { success: false, error: `Mã dịch vụ "${codeUp}" đã tồn tại` };
                appData.dichvu.push({ id: generateUniqueId("dv"), code: codeUp, name: name.trim(), group: (group || '').trim(), desc: (desc || '').trim(), disabled: false });
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderDichVuTable(); }
        });

        registerImportExportConfig('nguonkhach', {
            label: 'Nguồn khách hàng', fileNamePrefix: 'Danh_sach_nguon_khach',
            headers: ['Mã Nguồn', 'Tên Nguồn', 'Mô Tả'],
            templateExample: ['NK001', 'Facebook', 'Khách hàng đến từ quảng cáo Facebook'],
            exportRows: () => appData.nguonkhach.map(x => [x.code, x.name, x.desc || '']),
            importRow: (cells) => {
                const [code, name, desc] = cells;
                if (!code?.trim() || !name?.trim()) return { success: false, error: 'Thiếu Mã nguồn hoặc Tên nguồn' };
                const codeUp = code.trim().toUpperCase();
                if (appData.nguonkhach.some(x => x.code === codeUp)) return { success: false, error: `Mã nguồn "${codeUp}" đã tồn tại` };
                appData.nguonkhach.push({ id: generateUniqueId("nk"), code: codeUp, name: name.trim(), desc: (desc || '').trim(), disabled: false });
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderNguonKhachTable(); }
        });

        // Nhà Cung Cấp / Nhà Sản Xuất dùng MÃ TỰ PHÁT SINH (không cho nhập tay ở giao diện Thêm mới) -> khi
        // nhập từ Excel cũng giữ đúng nguyên tắc này: BỎ QUA cột Mã trong file (dù vẫn giữ cột này khi xuất
        // để tham khảo/đối chiếu), luôn tự sinh mã mới theo đúng bộ đếm hiện có, tránh trùng/sai lệch mã.
        registerImportExportConfig('nhacungcap', {
            label: 'Nhà cung cấp', fileNamePrefix: 'Danh_sach_nha_cung_cap',
            headers: ['Mã Nhà Cung Cấp (Tự động - bỏ qua khi nhập)', 'Tên Nhà Cung Cấp', 'Số Điện Thoại'],
            templateExample: ['(Sẽ tự động tạo)', 'Công ty TNHH Dược Phẩm ABC', '0281234567'],
            exportRows: () => appData.nhacungcap.map(x => [x.code, x.name, x.phone || '']),
            importRow: (cells) => {
                const [, name, phone] = cells;
                if (!name?.trim()) return { success: false, error: 'Thiếu Tên nhà cung cấp' };
                const newCode = previewNhaCungCapCode();
                appData.nhacungcap.push({ id: generateUniqueId("ncc"), code: newCode, name: name.trim(), phone: (phone || '').trim(), disabled: false });
                appData.nhaCungCapNextNumber = (appData.nhaCungCapNextNumber || 1) + 1;
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderNhaCungCapTable(); }
        });

        registerImportExportConfig('nhasanxuat', {
            label: 'Nhà sản xuất', fileNamePrefix: 'Danh_sach_nha_san_xuat',
            headers: ['Mã Nhà Sản Xuất (Tự động - bỏ qua khi nhập)', 'Tên Nhà Sản Xuất', 'Nước Sản Xuất'],
            templateExample: ['(Sẽ tự động tạo)', 'Sanofi', 'Pháp'],
            exportRows: () => appData.nhasanxuat.map(x => [x.code, x.name, x.country || '']),
            importRow: (cells) => {
                const [, name, country] = cells;
                if (!name?.trim()) return { success: false, error: 'Thiếu Tên nhà sản xuất' };
                const newCode = previewNhaSanXuatCode();
                appData.nhasanxuat.push({ id: generateUniqueId("nsx"), code: newCode, name: name.trim(), country: (country || '').trim(), disabled: false });
                appData.nhaSanXuatNextNumber = (appData.nhaSanXuatNextNumber || 1) + 1;
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderNhaSanXuatTable(); }
        });

        // Thuốc: Mã NHẬP TAY (không tự sinh) nên đọc/kiểm tra trùng trực tiếp từ file như các danh mục khác.
        // Cột "Tỷ Lệ Quy Đổi" đóng gói dạng "Tên=SốLượng;Tên=SốLượng" (vd: "Vỉ=10;Hộp=10") để có thể lưu
        // NHIỀU mức quy đổi trong 1 ô của Excel - khi nhập sẽ được tách lại đúng thành mảng như khi thêm tay.
        // Cột "Tồn Kho Hiện Tại" CHỈ mang tính tham khảo khi xuất (đúng nguyên tắc trường này luôn được TÍNH,
        // không cho nhập tay) - khi nhập, giá trị này bị bỏ qua và luôn khởi tạo lại = Tồn Kho Đầu Kỳ, giống
        // hệt hành vi của giao diện Thêm Thuốc Mới.
        registerImportExportConfig('thuoc', {
            label: 'Thuốc và Tồn kho', fileNamePrefix: 'Danh_sach_thuoc_ton_kho',
            headers: ['Mã Thuốc', 'Tên Thuốc', 'Nhóm Thuốc', 'Tên Hoạt Chất', 'Hàm Lượng', 'Dạng Bào Chế', 'Quy Cách Đóng Gói', 'Đường Dùng', 'Phân Nhóm Dược Lý', 'Phân Loại Kê Đơn', 'Phân Loại Quản Lý Đặc Biệt', 'Nhà Sản Xuất', 'Nước Sản Xuất', 'Tồn Kho Đầu Kỳ', 'Đơn Vị Nhỏ Nhất', 'Tỷ Lệ Quy Đổi (vd: Vỉ=10;Hộp=10)', 'Tồn Kho Hiện Tại (Tự động tính - bỏ qua khi nhập)'],
            templateExample: ['PARA500', 'Paracetamol 500mg', 'Thuốc giảm đau, hạ sốt', 'Paracetamol', '500mg', 'Viên nén', 'Hộp 10 vỉ x 10 viên', 'Uống', 'Nhóm giảm đau', 'Thuốc không kê đơn (OTC)', 'Thường', 'Sanofi', 'Pháp', '100', 'Viên', 'Vỉ=10;Hộp=10', '(Tự động tính)'],
            exportRows: () => appData.thuoc.map(x => [
                x.code, x.name, x.group || '', x.activeIngredient || '', x.strength || '', x.dosageForm || '',
                x.packaging || '', x.route || '', x.pharmacologyGroup || '', x.prescriptionType || '', x.specialControl || 'Thường',
                x.manufacturer || '', x.manufacturerCountry || '', x.openingStock ?? 0, x.baseUnit || '',
                (x.conversions || []).map(c => `${c.unitName}=${c.ratio}`).join(';'),
                x.currentStock ?? 0
            ]),
            importRow: (cells) => {
                const [code, name, group, activeIngredient, strength, dosageForm, packaging, route, pharmacologyGroup, prescriptionType, specialControl, manufacturer, manufacturerCountry, openingStockRaw, baseUnit, conversionsRaw] = cells;
                if (!code?.trim() || !name?.trim()) return { success: false, error: 'Thiếu Mã Thuốc hoặc Tên Thuốc' };
                const codeUp = code.trim().toUpperCase();
                if (appData.thuoc.some(x => x.code === codeUp)) return { success: false, error: `Mã thuốc "${codeUp}" đã tồn tại` };
                const openingStock = parseInt(openingStockRaw, 10) || 0;
                let conversions = [];
                if (conversionsRaw && conversionsRaw.trim()) {
                    conversions = conversionsRaw.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
                        const [unitName, ratioStr] = pair.split('=');
                        return { unitName: (unitName || '').trim(), ratio: parseInt(ratioStr, 10) || 0 };
                    }).filter(c => c.unitName);
                }
                appData.thuoc.push({
                    id: generateUniqueId("th"), code: codeUp, name: name.trim(), group: (group || '').trim(),
                    activeIngredient: (activeIngredient || '').trim(), strength: (strength || '').trim(), dosageForm: (dosageForm || '').trim(),
                    packaging: (packaging || '').trim(), route: (route || '').trim(), pharmacologyGroup: (pharmacologyGroup || '').trim(),
                    prescriptionType: (prescriptionType || '').trim(), specialControl: (specialControl || '').trim() || 'Thường',
                    manufacturer: (manufacturer || '').trim(), manufacturerCountry: (manufacturerCountry || '').trim(),
                    openingStock, currentStock: openingStock, baseUnit: (baseUnit || '').trim(), conversions, disabled: false, history: []
                });
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderThuocTable(); }
        });

        registerImportExportConfig('nhomloaivanban', {
            label: 'Nhóm loại văn bản', fileNamePrefix: 'Danh_sach_nhom_loai_van_ban',
            headers: ['Mã Nhóm', 'Tên Nhóm', 'Nhóm Cha (để trống nếu là cấp 1)'],
            templateExample: ['NLVB001', 'Văn bản hành chính', ''],
            exportRows: () => appData.nhomloaivanban.map(x => [x.code, x.name, x.parentId ? (appData.nhomloaivanban.find(p => p.id === x.parentId)?.name || '') : '']),
            importRow: (cells) => {
                const [code, name, parentName] = cells;
                if (!code?.trim() || !name?.trim()) return { success: false, error: 'Thiếu Mã nhóm hoặc Tên nhóm' };
                const codeUp = code.trim().toUpperCase();
                if (appData.nhomloaivanban.some(x => x.code === codeUp)) return { success: false, error: `Mã nhóm "${codeUp}" đã tồn tại` };
                let parentId = null;
                if (parentName && parentName.trim()) {
                    const parent = appData.nhomloaivanban.find(x => x.name.toLowerCase() === parentName.trim().toLowerCase());
                    if (!parent) return { success: false, error: `Không tìm thấy nhóm cha "${parentName.trim()}" (phải tồn tại sẵn hoặc nằm ở dòng phía trên trong cùng file)` };
                    if (getNhomLoaiVanBanLevel(parent.id) >= 3) return { success: false, error: `Nhóm cha "${parentName.trim()}" đã ở cấp tối đa (cấp 3), không thể làm cha thêm` };
                    parentId = parent.id;
                }
                appData.nhomloaivanban.push({ id: generateUniqueId("nlvb"), code: codeUp, name: name.trim(), parentId, disabled: false });
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderNhomLoaiVanBanTable(); }
        });

        registerImportExportConfig('loaivanban', {
            label: 'Loại văn bản', fileNamePrefix: 'Danh_sach_loai_van_ban',
            headers: ['Mã Loại Văn Bản', 'Tên Loại Văn Bản', 'Ký Hiệu', 'Số Chữ Số Đệm', 'Số Bắt Đầu Đếm'],
            templateExample: ['LVB001', 'Công văn', 'CV', '4', '1'],
            exportRows: () => appData.loaivanban.map(x => [x.code, x.name, x.symbol, x.digits, x.nextNumber]),
            importRow: (cells) => {
                const [code, name, symbol, digitsStr, nextStr] = cells;
                if (!code?.trim() || !name?.trim() || !symbol?.trim()) return { success: false, error: 'Thiếu Mã loại văn bản / Tên / Ký hiệu' };
                const codeUp = code.trim().toUpperCase();
                if (appData.loaivanban.some(x => x.code === codeUp)) return { success: false, error: `Mã loại văn bản "${codeUp}" đã tồn tại` };
                const digits = parseInt(digitsStr, 10) || 4;
                const nextNumber = parseInt(nextStr, 10) || 1;
                appData.loaivanban.push({ id: generateUniqueId("lvb"), code: codeUp, name: name.trim(), symbol: symbol.trim().toUpperCase(), digits, nextNumber, disabled: false });
                return { success: true };
            },
            afterImport: async () => { await saveToLocalStorage(); renderLoaiVanBanTable(); }
        });

        registerImportExportConfig('cme', {
            label: 'Quản lý CME', fileNamePrefix: 'Danh_sach_cme', usesFreshSnapshot: true,
            headers: ['Họ Và Tên', 'Chức Danh', 'Vị Trí Chuyên Môn', 'Số Giấy Phép / CCHN', 'Phạm Vi Hành Nghề', 'Chương Trình Đào Tạo', 'Đơn Vị Đào Tạo', 'Thời Gian Đào Tạo (YYYY-MM-DD)', 'Số Tiết'],
            templateExample: ['Nguyễn Văn A', 'Bác sĩ', 'Da liễu', 'GPHN-00123', 'Khám và điều trị các bệnh về da', 'Cập nhật kiến thức Da liễu 2026', 'Bệnh viện Da liễu TP.HCM', '2026-07-01', '8'],
            // Mỗi nhân sự CME có thể có NHIỀU lần đào tạo -> xuất 1 DÒNG cho MỖI lần đào tạo (lặp lại thông
            // tin cơ bản của người đó ở mỗi dòng); nếu người đó CHƯA có lần đào tạo nào, vẫn xuất 1 dòng
            // với các cột đào tạo để trống - đảm bảo KHÔNG bỏ sót bất kỳ nhân sự hay quá trình đào tạo nào.
            exportRows: () => {
                const rows = [];
                appData.cme.forEach(x => {
                    const baseInfo = [x.hoten, x.chucdanh || '', x.vitrichuyenmon || '', x.sogiayphep || '', x.phamvihanhnghe || ''];
                    const trainings = x.trainings || [];
                    if (trainings.length === 0) {
                        rows.push([...baseInfo, '', '', '', '']);
                    } else {
                        trainings.forEach(t => {
                            rows.push([...baseInfo, t.chuongtrinh || '', t.donvidaotao || '', t.thoigian || '', t.sotiet || '']);
                        });
                    }
                });
                return rows;
            },
            // Nhập vào: nếu Họ tên + Số giấy phép trùng với 1 dòng ĐÃ XỬ LÝ TRƯỚC ĐÓ TRONG CÙNG FILE này,
            // hiểu là đang thêm THÊM 1 lần đào tạo nữa cho ĐÚNG người đó (không tạo trùng người) - khớp với
            // cách xuất ra (1 người nhiều dòng nếu có nhiều lần đào tạo). Nếu trùng với người ĐÃ CÓ SẴN
            // trong hệ thống từ trước, báo lỗi rõ ràng thay vì âm thầm sửa dữ liệu người đó.
            importRow: (cells, fresh) => {
                const [hoten, chucdanh, vitrichuyenmon, sogiayphep, phamvihanhnghe, chuongtrinh, donvidaotao, thoigian, sotiet] = cells;
                if (!hoten?.trim()) return { success: false, error: 'Thiếu Họ và tên' };
                const hotenTrim = hoten.trim();
                const sogiayphepTrim = (sogiayphep || '').trim();

                // Tìm người TRÙNG trong danh sách hiện tại (bao gồm cả người vừa được thêm bởi dòng trước
                // đó trong cùng file này, vì fresh.cme đã được cập nhật trực tiếp qua các lần gọi trước)
                let person = fresh.cme.find(p => p.hoten.trim().toLowerCase() === hotenTrim.toLowerCase() && (p.sogiayphep || '').trim().toLowerCase() === sogiayphepTrim.toLowerCase());

                if (!person) {
                    person = {
                        id: generateUniqueId("cme"), hoten: hotenTrim, chucdanh: (chucdanh || '').trim(),
                        vitrichuyenmon: (vitrichuyenmon || '').trim(), sogiayphep: sogiayphepTrim,
                        phamvihanhnghe: (phamvihanhnghe || '').trim(), trainings: [], history: [], _v: 1
                    };
                    fresh.cme.push(person);
                }

                // Nếu dòng này có kèm thông tin đào tạo (Chương trình đào tạo có điền), thêm vào đúng người đó
                if (chuongtrinh && chuongtrinh.trim()) {
                    person.trainings.push({
                        id: generateUniqueId("cmet"), chuongtrinh: chuongtrinh.trim(),
                        donvidaotao: (donvidaotao || '').trim(), thoigian: (thoigian || '').trim(), sotiet: (sotiet || '').trim()
                    });
                }
                return { success: true };
            },
            renderAfter: () => renderCmeTable()
        });

        registerImportExportConfig('nhatky', {
            label: 'Nhật ký hoạt động', fileNamePrefix: 'Nhat_ky_hoat_dong',
            headers: ['Thời Gian', 'Người Dùng', 'Loại', 'Module', 'Hành Động', 'Chi Tiết'],
            templateExample: [],
            exportRows: () => [...(appData.activityLogs || [])].sort((a, b) => b.datetime.localeCompare(a.datetime))
                .map(x => [formatLogDatetime(x.datetime), x.user, x.type === 'error' ? 'Lỗi' : 'Hoạt động', x.module, x.action, x.details])
        });

        registerImportExportConfig('vanban', {
            label: 'Quản lý văn bản', fileNamePrefix: 'Danh_sach_van_ban', usesFreshSnapshot: true,
            headers: ['Mã Văn Bản', 'Loại Văn Bản (Tên)', 'Trích Yếu', 'Ngày Ban Hành (YYYY-MM-DD)', 'Người Ký / Đơn Vị Soạn Thảo', 'Khoa Phòng (Tên)', 'Phiên Bản', 'Trả Lời VB Số', 'Ghi Chú', 'Đường Dẫn Lưu File', 'Nhóm Loại Văn Bản (Cấp 1)', 'Nhóm Loại Văn Bản (Cấp 2)', 'Nhóm Loại Văn Bản (Cấp 3)', 'Số Văn Bản Gốc'],
            templateExample: ['0001/2026/CV', 'Tên loại văn bản đã có trong hệ thống', 'Về việc...', '2026-07-17', 'Nguyễn Văn A', 'Tên phòng ban đã có trong hệ thống', 'v1.0', '', '', '', 'Tên nhóm cấp 1 (nếu có)', 'Tên nhóm cấp 2 (nếu có)', 'Tên nhóm cấp 3 (nếu có)', ''],
            exportRows: () => getVanBanFilteredList().map(x => {
                const lvb = appData.loaivanban.find(l => l.id === x.loaiVanBanId);
                const khoaPhong = x.khoaPhongId ? appData.phongban.find(p => p.id === x.khoaPhongId)?.name : '';
                const nhom1 = x.nhomCap1Id ? appData.nhomloaivanban.find(n => n.id === x.nhomCap1Id)?.name : '';
                const nhom2 = x.nhomCap2Id ? appData.nhomloaivanban.find(n => n.id === x.nhomCap2Id)?.name : '';
                const nhom3 = x.nhomCap3Id ? appData.nhomloaivanban.find(n => n.id === x.nhomCap3Id)?.name : '';
                return [x.code || '', lvb ? lvb.name : '', x.trichyeu || '', x.ngaybanhanh || '', x.nguoiky || '', khoaPhong || '', x.phienban || '', x.matraloidoc || '', x.ghichu || '', x.duongdan || '', nhom1 || '', nhom2 || '', nhom3 || '', x.sovanbangoc || ''];
            }),
            importRow: (cells, fresh) => {
                const [code, loaiVanBanName, trichyeu, ngaybanhanh, nguoiky, khoaPhongName, phienban, matraloidoc, ghichu, duongdan, nhom1Name, nhom2Name, nhom3Name, sovanbangoc] = cells;
                if (!code?.trim() || !trichyeu?.trim()) return { success: false, error: 'Thiếu Mã văn bản hoặc Trích yếu' };
                if (fresh.vanban.some(x => x.code === code.trim())) return { success: false, error: `Mã văn bản "${code.trim()}" đã tồn tại` };
                const lvb = loaiVanBanName?.trim() ? fresh.loaivanban.find(x => x.name.toLowerCase() === loaiVanBanName.trim().toLowerCase()) : null;
                if (loaiVanBanName?.trim() && !lvb) return { success: false, error: `Không tìm thấy Loại văn bản "${loaiVanBanName.trim()}"` };
                const khoaPhong = khoaPhongName?.trim() ? fresh.phongban.find(x => x.name.toLowerCase() === khoaPhongName.trim().toLowerCase()) : null;

                // Tra cứu Nhóm loại văn bản theo tên, đúng quan hệ cha-con: cấp 2 PHẢI là con trực tiếp của
                // cấp 1 đã chọn, cấp 3 PHẢI là con trực tiếp của cấp 2 đã chọn - tránh trường hợp trùng tên
                // nhóm ở nhánh khác nhau bị lấy nhầm.
                let nhom1 = null, nhom2 = null, nhom3 = null;
                if (nhom1Name?.trim()) {
                    nhom1 = fresh.nhomloaivanban.find(x => !x.parentId && x.name.toLowerCase() === nhom1Name.trim().toLowerCase());
                    if (!nhom1) return { success: false, error: `Không tìm thấy Nhóm loại văn bản cấp 1 "${nhom1Name.trim()}"` };
                }
                if (nhom2Name?.trim()) {
                    if (!nhom1) return { success: false, error: `Đã điền Nhóm cấp 2 "${nhom2Name.trim()}" nhưng chưa chọn Nhóm cấp 1 tương ứng` };
                    nhom2 = fresh.nhomloaivanban.find(x => x.parentId === nhom1.id && x.name.toLowerCase() === nhom2Name.trim().toLowerCase());
                    if (!nhom2) return { success: false, error: `Không tìm thấy Nhóm loại văn bản cấp 2 "${nhom2Name.trim()}" trực thuộc nhóm cấp 1 "${nhom1Name.trim()}"` };
                }
                if (nhom3Name?.trim()) {
                    if (!nhom2) return { success: false, error: `Đã điền Nhóm cấp 3 "${nhom3Name.trim()}" nhưng chưa chọn Nhóm cấp 2 tương ứng` };
                    nhom3 = fresh.nhomloaivanban.find(x => x.parentId === nhom2.id && x.name.toLowerCase() === nhom3Name.trim().toLowerCase());
                    if (!nhom3) return { success: false, error: `Không tìm thấy Nhóm loại văn bản cấp 3 "${nhom3Name.trim()}" trực thuộc nhóm cấp 2 "${nhom2Name.trim()}"` };
                }

                fresh.vanban.push({
                    id: generateUniqueId("vb"), code: code.trim(), loaiVanBanId: lvb ? lvb.id : null, trichyeu: trichyeu.trim(),
                    ngaybanhanh: (ngaybanhanh || '').trim(), nguoiky: (nguoiky || '').trim(), khoaPhongId: khoaPhong ? khoaPhong.id : null,
                    phienban: (phienban || '').trim(), matraloidoc: (matraloidoc || '').trim(), sovanbangoc: (sovanbangoc || '').trim(), ghichu: (ghichu || '').trim(),
                    duongdan: (duongdan || '').trim(), daphathanh: false, phathanhden: '',
                    nhomCap1Id: nhom1 ? nhom1.id : null, nhomCap2Id: nhom2 ? nhom2.id : null, nhomCap3Id: nhom3 ? nhom3.id : null,
                    history: [], _v: 1, createdAt: new Date().toISOString()
                });
                return { success: true };
            },
            renderAfter: () => renderVanBanTable()
        });

        bindEnterKeySubmit(['username', 'password'], handleLogin);

        // Modal Nhân viên: Enter ở bất kỳ trường nào -> Lưu thông tin
        bindEnterKeySubmit(['nv-code', 'nv-name', 'nv-phongban', 'nv-vaitro', 'nv-user', 'nv-pass'], saveNhanVien);

        // Modal Vai trò & Phân quyền: Enter -> Lưu vai trò
        bindEnterKeySubmit(['vt-name', 'vt-code'], saveVaiTro);

        // Modal Phòng ban: Enter ở Mã/Tên phòng ban -> Lưu phòng ban
        // (Ô "Mô tả" là textarea nên KHÔNG bind Enter tại đây, để giữ chức năng xuống dòng khi mô tả dài)
        bindEnterKeySubmit(['pb-code', 'pb-name'], savePhongBan);

        // Modal Dịch vụ: Enter ở Mã/Tên dịch vụ -> Lưu dịch vụ
        // (Ô "Mô tả" là textarea nên KHÔNG bind Enter tại đây)
        bindEnterKeySubmit(['dv-code', 'dv-name', 'dv-group'], saveDichVu);

        // Modal Đặt lịch hẹn: Enter ở Tên khách hàng/SĐT/Địa chỉ/Thời gian hẹn -> Lưu lịch hẹn
        bindEnterKeySubmit(['lh-customer-name', 'lh-phone', 'lh-datetime-date'], saveLichHen);

        // Modal Đặt lịch Tái khám, thay băng, cắt chỉ: Enter ở Tên khách hàng/SĐT/Địa chỉ/Thời gian hẹn -> Lưu lịch hẹn
        bindEnterKeySubmit(['tk-customer-name', 'tk-phone', 'tk-datetime-date'], saveTaiKham);

        // Modal Đặt lịch phẫu thuật: Enter ở Mã KH/Tên khách hàng/SĐT/Thời gian phẫu thuật -> Lưu lịch phẫu thuật
        bindEnterKeySubmit(['pt-code', 'pt-customer-name', 'pt-phone', 'pt-address', 'pt-dob', 'pt-cccd', 'pt-cccd-issue-place', 'pt-cccd-issue-date', 'pt-datetime-date'], saveLichPhauThuat);

        // Modal Nguồn khách hàng: Enter ở Mã/Tên nguồn -> Lưu nguồn khách
        // (Ô "Mô tả" là textarea nên KHÔNG bind Enter tại đây)
        bindEnterKeySubmit(['nk-code', 'nk-name'], saveNguonKhach);
        bindEnterKeySubmit(['ncc-name', 'ncc-phone'], saveNhaCungCap);
        bindEnterKeySubmit(['nsx-name', 'nsx-country'], saveNhaSanXuat);
        bindEnterKeySubmit(['dvt-code', 'dvt-name'], saveDonViTinh);
        bindEnterKeySubmit(['th-code', 'th-name'], saveThuoc);

        // Modal Loại văn bản: Enter ở bất kỳ trường nào -> Lưu loại văn bản
        bindEnterKeySubmit(['nlvb-code', 'nlvb-name'], saveNhomLoaiVanBan);

        bindEnterKeySubmit(['lvb-code', 'lvb-name', 'lvb-symbol', 'lvb-digits', 'lvb-next'], saveLoaiVanBan);

        // Modal Văn bản: Enter ở Mã văn bản/Đường dẫn lưu file -> Lưu văn bản
        bindEnterKeySubmit(['vb-code', 'vb-nguoiky', 'vb-phienban', 'vb-matraloidoc', 'vb-sovanbangoc', 'vb-duongdan', 'vb-phathanhden'], saveVanBan);

        // Modal Lọc nâng cao Văn bản: Enter ở bất kỳ trường nào -> Tìm kiếm
        bindEnterKeySubmit(['filter-vb-code', 'filter-vb-matraloidoc', 'filter-vb-sovanbangoc', 'filter-vb-nguoiky', 'filter-vb-from', 'filter-vb-to'], applyVanBanFilter);

        // Modal Lọc nâng cao Data: Enter ở bất kỳ trường nào -> Tìm kiếm
        bindEnterKeySubmit(['filter-cd-from', 'filter-cd-to'], applyCrmDataFilter);

        // Modal CME: Enter ở các trường text -> Lưu thông tin CME
        bindEnterKeySubmit(['cme-hoten', 'cme-chucdanh', 'cme-vitrichuyenmon', 'cme-sogiayphep'], saveCme);

        // Modal Thêm quá trình đào tạo: Enter ở các trường -> Lưu quá trình đào tạo
        bindEnterKeySubmit(['cme-training-chuongtrinh', 'cme-training-donvi', 'cme-training-thoigian', 'cme-training-sotiet'], saveCmeTraining);

        // Modal CRM - Danh sách Data: Enter ở Số điện thoại/Tên nick -> Lưu data
        bindEnterKeySubmit(['cd-phone', 'cd-nickname', 'cd-received-time-date'], saveCrmData);

        // Modal CRM - Danh sách khách hàng: Enter ở Mã KH/Tên/SĐT/Địa chỉ/Ngày sinh/CCCD -> Lưu khách hàng
        bindEnterKeySubmit(['ck-code', 'ck-customer-name', 'ck-phone', 'ck-address', 'ck-dob', 'ck-cccd', 'ck-cccd-issue-place', 'ck-cccd-issue-date', 'ck-surgery-datetime'], saveCrmKhachHang);

        // Modal Lọc nâng cao Đặt lịch hẹn: Enter ở bất kỳ trường nào -> Thực thi tìm kiếm ngay
        bindEnterKeySubmit(['filter-lh-name', 'filter-lh-phone', 'filter-lh-from', 'filter-lh-to'], applyAdvancedFilter);

        // Modal Lọc nâng cao Tái khám, thay băng, cắt chỉ: Enter ở bất kỳ trường nào -> Thực thi tìm kiếm ngay
        bindEnterKeySubmit(['filter-tk-name', 'filter-tk-phone', 'filter-tk-from', 'filter-tk-to'], applyTaiKhamAdvancedFilter);

        // Modal Lọc nâng cao Lịch phẫu thuật: Enter ở bất kỳ trường nào -> Thực thi tìm kiếm ngay
        bindEnterKeySubmit(['filter-pt-name', 'filter-pt-phone', 'filter-pt-from', 'filter-pt-to'], applyLichPhauThuatAdvancedFilter);

        // Cấu hình mã phát sinh: Enter ở bất kỳ trường nào -> Lưu cấu hình ngay
        bindEnterKeySubmit(['cfg-code-prefix', 'cfg-code-digits', 'cfg-code-next'], saveSurgeryCodeConfig);

        // Modal Đổi mật khẩu Admin: Enter -> Cập nhật mật khẩu
        bindEnterKeySubmit(['old-pass', 'new-pass', 'confirm-new-pass'], changePassword);
