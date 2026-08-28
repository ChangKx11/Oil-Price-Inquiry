/*
 * 油价查询脚本 - 增强版爬虫（模拟浏览器）
 * 数据源：m.qiyoujiage.com
 * 支持省份、油品参数，默认福建 95号
 */

const provinceMap = {
    '北京':'beijing','上海':'shanghai','广东':'guangdong','深圳':'shenzhen',
    '山东':'shandong','江苏':'jiangsu','浙江':'zhejiang','福建':'fujian',
    '河南':'henan','湖北':'hubei','湖南':'hunan','四川':'sichuan',
    '重庆':'chongqing','辽宁':'liaoning','吉林':'jilin','黑龙江':'heilongjiang',
    '河北':'hebei','山西':'shanxi','陕西':'shaanxi','甘肃':'gansu',
    '青海':'qinghai','云南':'yunnan','贵州':'guizhou','海南':'hainan',
    '安徽':'anhui','江西':'jiangxi','广西':'guangxi','内蒙古':'neimenggu',
    '西藏':'xizang','宁夏':'ningxia','新疆':'xinjiang'
};

const oilTypeMap = {
    '92':'92号汽油','95':'95号汽油','98':'98号汽油','0h':'0号柴油'
};

// ===== 安全解析参数 =====
let provinceName = '福建';
let oilType = '95';
try {
    const argStr = typeof $argument === 'string' ? $argument : String($argument || '');
    if (argStr) {
        const parts = argStr.split(',').map(s => s.trim());
        if (parts[0]) provinceName = parts[0];
        if (parts[1]) oilType = parts[1];
    }
} catch(e) {
    console.log('[油价查询] 参数解析失败，使用默认值');
}

const provincePinyin = provinceMap[provinceName] || provinceName;
const oilLabel = oilTypeMap[oilType] || oilType;

// 尝试 HTTPS，如果失败则回退到 HTTP
const urls = [
    `https://m.qiyoujiage.com/${provincePinyin}.shtml`,
    `http://m.qiyoujiage.com/${provincePinyin}.shtml`
];

console.log(`[油价查询] 查询 ${provinceName} ${oilLabel}，尝试URL: ${urls[0]}`);

function main() {
    // 完整的浏览器请求头
    const headers = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
    };

    // 尝试请求（先 HTTPS，失败后回退 HTTP）
    tryRequest(urls[0], headers, 0);
}

function tryRequest(url, headers, attempt) {
    console.log(`[油价查询] 尝试 ${attempt + 1}/${urls.length}: ${url}`);

    $httpClient.get({
        url: url,
        timeout: 10,
        headers: headers
    }, (error, response, data) => {
        if (error) {
            console.log(`[油价查询] 请求失败: ${error}`);
            // 如果还有备选 URL，继续尝试
            if (attempt + 1 < urls.length) {
                tryRequest(urls[attempt + 1], headers, attempt + 1);
            } else {
                $notification.post('⛽ 油价查询失败', provinceName, `所有URL均请求超时\n${error}`);
                $done();
            }
            return;
        }

        console.log(`[油价查询] 响应状态码: ${response ? response.statusCode : '无响应'}`);

        if (response && response.statusCode !== 200) {
            $notification.post('⛽ 油价查询失败', provinceName, `HTTP状态码: ${response.statusCode}`);
            $done();
            return;
        }

        try {
            const priceInfo = parseOilPrice(data, oilType);
            const prediction = parsePrediction(data);
            if (priceInfo) {
                let title = `⛽ ${provinceName} ${oilLabel}`;
                let body = `当前价格：${priceInfo.price} 元/升`;
                if (priceInfo.change) body += ` ${formatChange(priceInfo.change)}`;
                if (prediction && prediction.rawText) body += `\n---\n📅 ${prediction.rawText}`;
                $notification.post(title, '📊 实时油价及预测', body);
                console.log(`[油价查询] 通知发送成功`);
            } else {
                $notification.post('⛽ 查询失败', provinceName, `未找到 ${oilLabel} 价格`);
                console.log(`[油价查询] 页面预览: ${data.substring(0, 300)}`);
            }
        } catch(e) {
            $notification.post('⛽ 异常', provinceName, `解析失败\n${e.message}`);
            console.log(`[油价查询] 异常: ${e.stack}`);
        }
        $done();
    });
}

// ============ 解析函数（保持不变） ============
function parseOilPrice(html, targetType) {
    const keyword = oilTypeMap[targetType] || targetType;
    let price = null;
    const patterns = [
        new RegExp(`${keyword}[\\s\\S]*?(\\d+\\.\\d{2})\\s*元/升`,'i'),
        new RegExp(`${keyword}[\\s\\S]*?(\\d+\\.?\\d*)\\s*元`,'i')
    ];
    for (let p of patterns) {
        const m = html.match(p);
        if (m && m[1]) { price = m[1]; break; }
    }
    if (!price) {
        const all = html.match(/(\d+\.\d{2})\s*元\/?升?/g);
        if (all && all.length) {
            const order = ['92','95','98','0h'];
            const idx = order.indexOf(targetType);
            if (idx !== -1 && idx < all.length) {
                const m = all[idx].match(/(\d+\.\d{2})/);
                if (m) price = m[1];
            }
        }
    }
    if (!price) return null;
    let change = null;
    const cm = html.match(new RegExp(`${keyword}[\\s\\S]*?([↑↓↗↘])\\s*(\\d+\\.?\\d*)`,'i'));
    if (cm) {
        const sym = cm[1], val = cm[2];
        if (sym === '↑' || sym === '↗') change = '+' + val;
        else if (sym === '↓' || sym === '↘') change = '-' + val;
        else change = val;
    }
    return { price, change };
}

function parsePrediction(html) {
    const result = { date:null, direction:null, amountPerTon:null, amountPerLiterMin:null, amountPerLiterMax:null, rawText:null };
    try {
        const dm = html.match(/下次油价(\d+月\d+日)24时调整/);
        if (dm) result.date = dm[1];
        const am = html.match(/预计(上调|下调|搁浅)(\d+)?元\/吨/);
        if (am) { result.direction = am[1]; if (am[2]) result.amountPerTon = am[2]; }
        const rm = html.match(/\((\d+\.\d+)元\/升-(\d+\.\d+)元\/升\)/);
        if (rm) { result.amountPerLiterMin = rm[1]; result.amountPerLiterMax = rm[2]; }
        else {
            const sm = html.match(/预计(?:上调|下调)\d+元\/吨[^\(]*\((\d+\.\d+)元\/升\)/);
            if (sm) { result.amountPerLiterMin = sm[1]; result.amountPerLiterMax = sm[1]; }
        }
        if (result.date || result.direction) {
            let parts = [];
            if (result.date) parts.push(`下次调价 ${result.date}`);
            if (result.direction) {
                if (result.direction === '搁浅') parts.push('预计搁浅（不作调整）');
                else {
                    let detail = `预计${result.direction}`;
                    if (result.amountPerTon) detail += ` ${result.amountPerTon}元/吨`;
                    if (result.amountPerLiterMin && result.amountPerLiterMax) detail += ` (${result.amountPerLiterMin}-${result.amountPerLiterMax}元/升)`;
                    else if (result.amountPerLiterMin) detail += ` (${result.amountPerLiterMin}元/升)`;
                    parts.push(detail);
                }
            }
            result.rawText = parts.join('\n');
        }
    } catch(e) {}
    return result;
}

function formatChange(change) {
    if (!change) return '';
    if (change.startsWith('+')) return `📈 涨 ${change.substring(1)} 元`;
    if (change.startsWith('-')) return `📉 跌 ${change.substring(1)} 元`;
    return `(${change})`;
}

main();
