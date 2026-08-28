/*
 * 油价查询脚本 - 使用 ApiZero 接口（含调价预测）
 * 默认：福建 95号汽油
 */

const oilTypeMap = {
    '92':'92号汽油',
    '95':'95号汽油',
    '98':'98号汽油',
    '0h':'0号柴油'
};

const DEFAULT_PROVINCE = '福建';
const DEFAULT_OIL = '95';

// ===== 参数解析 =====
function parseArgument(arg) {
    let province = DEFAULT_PROVINCE;
    let oil = DEFAULT_OIL;
    try {
        if (typeof arg === 'string') {
            const parts = arg.split(',').map(s => s.trim());
            if (parts[0] && !parts[0].includes('object')) province = parts[0];
            if (parts[1] && !parts[1].includes('object')) oil = parts[1];
        } else if (typeof arg === 'object' && arg !== null) {
            const p = arg.province || arg[0] || arg.prov;
            if (p && typeof p === 'string' && !p.includes('object')) province = p;
            const o = arg.oilType || arg[1] || arg.oil || arg.type;
            if (o && typeof o === 'string' && !o.includes('object')) oil = o;
        }
    } catch (e) { console.log('[油价] 参数解析异常，使用默认值'); }
    if (province.includes('object')) province = DEFAULT_PROVINCE;
    if (oil.includes('object')) oil = DEFAULT_OIL;
    return { province, oil };
}

const params = parseArgument($argument);
const provinceName = params.province;
const oilType = params.oil;
const oilLabel = oilTypeMap[oilType] || oilType;

console.log(`[油价] 查询 ${provinceName} ${oilLabel}`);

const API_URL = `https://v1.apizero.cn/api/oil-price-forecast?action=forecast&province=${encodeURIComponent(provinceName)}`;
console.log(`[油价] 请求: ${API_URL}`);

function main() {
    $httpClient.get({ url: API_URL, timeout: 10 }, (error, response, data) => {
        if (error) {
            $notification.post('⛽ 油价查询失败', provinceName, `网络错误\n${error}`);
            $done(); return;
        }
        if (response && response.statusCode !== 200) {
            $notification.post('⛽ 查询失败', provinceName, `HTTP ${response.statusCode}`);
            $done(); return;
        }

        try {
            const json = JSON.parse(data);
            // 注意：ApiZero 返回的 code 为 0 表示成功
            if (json.code !== 0) {
                $notification.post('⛽ 查询失败', provinceName, `API错误: ${json.msg || '未知错误'}`);
                $done(); return;
            }

            const result = json.data;
            let price = null, change = null, forecast = null;

            // 提取指定油品价格
            if (result.prices) {
                for (let p of result.prices) {
                    // 匹配油品类型，如 gasoline_95
                    if (p.type === `gasoline_${oilType}` || p.name.includes(oilLabel)) {
                        price = p.price;
                        break;
                    }
                }
            }

            // 提取涨跌预测
            if (result.forecast) {
                forecast = result.forecast; // 如 "预计上调0.15元/升"
            }

            if (price !== null) {
                let title = `⛽ ${provinceName} ${oilLabel}`;
                let body = `当前价格：${price} 元/升`;
                if (forecast) body += `\n---\n📅 调价预测：${forecast}`;
                $notification.post(title, '📊 实时油价及预测', body);
                console.log('[油价] 通知发送成功');
            } else {
                $notification.post('⛽ 查询失败', provinceName, `未找到 ${oilLabel} 价格`);
            }
        } catch (e) {
            $notification.post('⛽ 异常', provinceName, `数据解析失败\n${e.message}`);
        }
        $done();
    });
}

main();
