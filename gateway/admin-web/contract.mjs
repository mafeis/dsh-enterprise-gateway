/**
 * 绠＄悊鍙?路 瀹樻柟 Client Contract锛堝彈鏀寔 API锛?
 *
 * 杩欐槸鎻掍欢椤甸潰鍞竴鍏佽渚濊禆鐨勫３鎺ュ彛 鈥斺€?瀵归綈 DSH 瑙勮寖锛?
 *   銆屽彈鏀寔鐨勭涓夋柟鍏煎杈圭晫鍙湁 contract 妯″潡瀵煎嚭鐨勫唴瀹癸紱
 *     绉佹湁绫诲瀷鍑虹幇鍦ㄥ彲杈捐矾寰勪腑涓嶄唬琛ㄦ垚涓哄彈鏀寔 capability銆嶏紙瑙勮寖 8.1锛?
 *
 * 鎻掍欢椤甸潰妯″潡锛?name>.web/锛夊彧鍑?import 鏈ā鍧?+ 鑷韩璧勬簮銆?
 * 鏈枃浠跺鍑虹殑鍑芥暟绛惧悕 = 鎻掍欢椤甸潰瑙勮寖鐨勪竴閮ㄥ垎锛屾敼鍔ㄥ繀椤诲悜鍚庡吋瀹癸紙瑙勮寖锛氬吋瀹逛紭鍏堬級銆?
 */
export { api, $, toast, esc, confirmDlg, must, fmtTok } from './js/core.mjs'
export { icon } from './icons.mjs'
/**
 * 渚ц竟鏍忕鐞嗛挬瀛愶紙澹虫嫢鏈夌殑鍏冪礌锛夛細渚涚鐞嗗鑸殑鎻掍欢椤甸潰璇诲彇褰撳墠瀵艰埅娉ㄥ唽琛?/
 * 搴旂敤鏂扮殑鎺掑簭鏄鹃殣鍋忓ソ锛堝亸濂芥寔涔呭寲鍦ㄧ綉鍏?/admin/nav-config锛宔nt-console 钀界洏锛夈€?
 * 浠呭鑸鐞嗙被鎻掍欢浣跨敤锛涗竴鑸彃浠堕〉闈㈡棤闇€鍏冲績銆?
 */
export { openDlg, closeDlg } from './js/core.mjs'
export { getNavState, applyNavPrefs } from './js/router.mjs'
