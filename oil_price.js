/*
 * 油价查询脚本 - 默认查询福建 95号汽油
 * 支持参数：字符串 "福建,95" 或对象 {province:'福建', oilType:'95'} 或数组
 * 增强异常处理，避免 [object Object] 问题
 */

// ============ 省份拼音映射 ============
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

// ============ 智能参数解析（带详细日志） ============
function parseArguments(arg) {
    let province = '福建';   // 默认
    let oil = '95';         // 默认

    console.log(`[油价查询] 原始参数类型: ${typeof arg}, 内容: ${JSON.stringify(arg)}`);

    try {
        if (typeof arg === 'string') {
            const str = arg.trim();
            if (str === '' || str === '[object Object]' || str.includes('[object Object]')) {
                console.log('[油价查询] 参数为异常字符串，使用默认值');
            } else {
                const parts = str.split(',').map(s => s.trim());
                if (parts[0] && !parts[0].includes('[object') && !parts[0].includes('Object')) {
                    province = parts[0];
                } else {
                    console.log(`[油价查询] 省份部分无效: "${parts[0]}"，使用默认`);
                }
                if (parts[1] && !parts[1].includes('[object')) {
                    oil = parts[1];
                } else {
                    console.log(`[油价查询] 油品部分无效: "${parts[1]}"，使用默认`);
                }
            }
        } else if (typeof arg === 'object' && arg !== null) {
            // 尝试从对象属性提取
            const pVal = arg.province || arg[0] || arg.prov;
            if (pVal && typeof pVal === 'string' && !pVal.includes('[object')) {
                province = pVal;
            }
            const oVal = arg.oilType || arg[1] || arg.oil || arg.type;
            if (oVal && typeof oVal === 'string' && !oVal.includes('[object')) {
                oil = oVal;
            }
            // 如果还是没有提取到，则使用默认值（已在外部定义）
        } else {
            // 其他类型（数字等），使用默认值
            console.log(`[油价查询] 不支持的参数类型，使用默认值`);
        }
    } catch (e) {
        console.log(`[油价查询] 参数解析异常: ${e.message}，使用默认值`);
    }

    console.log(`[油价查询] 最终解析结果：省份=${province}, 油品=${oil}`);
    return { province, oil };
}

const params = parseArguments($argument);
let provinceName = params.province;
let oilType = params.oil;

const provincePinyin = provinceMap[provinceName] || provinceName;
const oilLabel = oilTypeMap[oilType] || oilType;
const url = `http://m.qiyoujiage.com/${provincePinyin}.shtml`;

console.log(`[油价查询] 请求URL: ${url}`);

// ============ 主函数 ============
function main() {
    $httpClient.get({ url, timeout: 15 }, (error, response, data) => {
        if (error) {
            $notification.post('⛽ 油价查询失败', provinceName, `网络请求失败\n${error}`);
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
            }
        } catch (e) {
            $notification.post('⛽ 异常', provinceName, `解析失败\n${e.message}`);
        }
        $done();
    });
}

// ============ 解析当前油价 ============
function parseOilPrice(html, targetType) {
    const keyword = oilTypeMap[targetType] || targetType;
    let price = null;
    const patterns = [
        new RegExp(`${keyword}[\\s\\S]*?(\\d+\\.\\d{2})\\s*元/升`, 'i'),
        new RegExp(`${keyword}[\\s\\S]*?(\\d+\\.?\\d*)\\s*元`, 'i')
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
    const cm = html.match(new RegExp(`${keyword}[\\s\\S]*?([↑↓↗↘])\\s*(\\d+\\.?\\d*)`, 'i'));
    if (cm) {
        const sym = cm[1], val = cm[2];
        if (sym === '↑' || sym === '↗') change = '+' + val;
        else if (sym === '↓' || sym === '↘') change = '-' + val;
        else change = val;
    }
    return { price, change };
}

// ============ 解析预测信息 ============
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

// ============ 格式化涨跌 ============
function formatChange(change) {
    if (!change) return '';
    if (change.startsWith('+')) return `📈 涨 ${change.substring(1)} 元`;
    if (change.startsWith('-')) return `📉 跌 ${change.substring(1)} 元`;
    return `(${change})`;
}

// ============ 执行 ============
main();
