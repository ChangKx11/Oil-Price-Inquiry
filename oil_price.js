/*
 * 油价查询脚本 - 基于 m.qiyoujiage.com
 * 功能：查询指定省份实时油价 + 下一轮调价预估
 * 参数：province（中文省份名）, oilType（92/95/98/0h）
 */

// ============ 省份拼音映射（用于构造URL） ============
const provinceMap = {
    '北京': 'beijing',
    '上海': 'shanghai',
    '广东': 'guangdong',
    '深圳': 'shenzhen',
    '山东': 'shandong',
    '江苏': 'jiangsu',
    '浙江': 'zhejiang',
    '福建': 'fujian',
    '河南': 'henan',
    '湖北': 'hubei',
    '湖南': 'hunan',
    '四川': 'sichuan',
    '重庆': 'chongqing',
    '辽宁': 'liaoning',
    '吉林': 'jilin',
    '黑龙江': 'heilongjiang',
    '河北': 'hebei',
    '山西': 'shanxi',
    '陕西': 'shaanxi',
    '甘肃': 'gansu',
    '青海': 'qinghai',
    '云南': 'yunnan',
    '贵州': 'guizhou',
    '海南': 'hainan',
    '安徽': 'anhui',
    '江西': 'jiangxi',
    '广西': 'guangxi',
    '内蒙古': 'neimenggu',
    '西藏': 'xizang',
    '宁夏': 'ningxia',
    '新疆': 'xinjiang'
};

// ============ 油品映射 ============
const oilTypeMap = {
    '92': '92号汽油',
    '95': '95号汽油',
    '98': '98号汽油',
    '0h': '0号柴油'
};

// ============ 获取用户参数 ============
const args = $argument ? $argument.split(',') : [];
const provinceName = (args[0] || '广东').trim();
const oilType = (args[1] || '92').trim();
const provincePinyin = provinceMap[provinceName] || provinceName;
const oilLabel = oilTypeMap[oilType] || oilType;
const url = `http://m.qiyoujiage.com/${provincePinyin}.shtml`;

console.log(`[油价查询] 查询 ${provinceName} ${oilLabel}，URL: ${url}`);

// ============ 主入口 ============
function main() {
    $httpClient.get({
        url: url,
        timeout: 15
    }, function(error, response, data) {
        if (error) {
            console.log(`[油价查询] 请求失败: ${error}`);
            $notification.post('⛽ 油价查询失败', provinceName, `网络请求失败\n${error}`);
            $done();
            return;
        }

        try {
            const priceInfo = parseOilPrice(data, oilType);
            const prediction = parsePrediction(data);

            // 构建通知内容
            if (priceInfo) {
                let title = `⛽ ${provinceName} ${oilLabel}`;
                let body = `当前价格：${priceInfo.price} 元/升`;
                if (priceInfo.change) {
                    body += ` ${formatChange(priceInfo.change)}`;
                }

                if (prediction && prediction.rawText) {
                    body += `\n---\n📅 ${prediction.rawText}`;
                }

                console.log(`[油价查询] 通知内容: ${title} | ${body}`);
                $notification.post(title, '📊 实时油价及预测', body);
            } else {
                $notification.post('⛽ 油价查询失败', provinceName, `未找到 ${oilLabel} 的价格数据，请确认省份名称正确。`);
            }
        } catch (e) {
            console.log(`[油价查询] 异常: ${e}`);
            $notification.post('⛽ 油价查询异常', provinceName, `解析失败\n${e.message}`);
        }
        $done();
    });
}

// ============ 解析当前油价 ============
function parseOilPrice(html, targetType) {
    const keyword = oilTypeMap[targetType] || targetType;

    // 匹配价格数字（如 7.28 元/升）
    const pricePatterns = [
        new RegExp(`${keyword}[\\s\\S]*?(\\d+\\.\\d{2})\\s*元/升`, 'i'),
        new RegExp(`${keyword}[\\s\\S]*?(\\d+\\.?\\d*)\\s*元`, 'i'),
        new RegExp(`(?:${keyword}|${targetType})[^\\d]*(\\d+\\.\\d{2})`, 'i')
    ];

    let price = null;
    for (const pattern of pricePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            price = match[1];
            break;
        }
    }

    // 如果正则匹配失败，尝试按位置匹配（页面中油价按 92、95、98、0号柴油 顺序排列）
    if (!price) {
        const allPrices = html.match(/(\d+\.\d{2})\s*元\/?升?/g);
        if (allPrices && allPrices.length > 0) {
            const typeOrder = ['92', '95', '98', '0h'];
            const index = typeOrder.indexOf(targetType);
            if (index !== -1 && index < allPrices.length) {
                const numMatch = allPrices[index].match(/(\d+\.\d{2})/);
                if (numMatch) price = numMatch[1];
            }
        }
    }

    if (!price) return null;

    // 提取涨跌信息（如 ↑0.28）
    let change = null;
    const changeMatch = html.match(new RegExp(`${keyword}[\\s\\S]*?([↑↓↗↘])\\s*(\\d+\\.?\\d*)`, 'i'));
    if (changeMatch) {
        const symbol = changeMatch[1];
        const value = changeMatch[2];
        if (symbol === '↑' || symbol === '↗') change = '+' + value;
        else if (symbol === '↓' || symbol === '↘') change = '-' + value;
        else change = value;
    }

    return { price, change };
}

// ============ 解析下一轮调价预估 ============
function parsePrediction(html) {
    const result = {
        date: null,
        direction: null,
        amountPerTon: null,
        amountPerLiterMin: null,
        amountPerLiterMax: null,
        rawText: null
    };

    try {
        // 1. 匹配调价日期：如 "下次油价8月28日24时调整"
        const dateMatch = html.match(/下次油价(\d+月\d+日)24时调整/);
        if (dateMatch) result.date = dateMatch[1];

        // 2. 匹配调价方向与吨价：如 "预计上调320元/吨" 或 "预计搁浅"
        const adjustMatch = html.match(/预计(上调|下调|搁浅)(\d+)?元\/吨/);
        if (adjustMatch) {
            result.direction = adjustMatch[1];
            if (adjustMatch[2]) result.amountPerTon = adjustMatch[2];
        }

        // 3. 匹配升价区间：如 "(0.24元/升-0.29元/升)"
        const rangeMatch = html.match(/\((\d+\.\d+)元\/升-(\d+\.\d+)元\/升\)/);
        if (rangeMatch) {
            result.amountPerLiterMin = rangeMatch[1];
            result.amountPerLiterMax = rangeMatch[2];
        } else {
            // 尝试匹配单个升价：如 "(0.24元/升)"
            const singleMatch = html.match(/预计(?:上调|下调)\d+元\/吨[^\(]*\((\d+\.\d+)元\/升\)/);
            if (singleMatch) {
                result.amountPerLiterMin = singleMatch[1];
                result.amountPerLiterMax = singleMatch[1];
            }
        }

        // 4. 生成可读的摘要文本
        if (result.date || result.direction) {
            let parts = [];
            if (result.date) parts.push(`下次调价 ${result.date}`);
            if (result.direction) {
                if (result.direction === '搁浅') {
                    parts.push('预计搁浅（不作调整）');
                } else {
                    let detail = `预计${result.direction}`;
                    if (result.amountPerTon) detail += ` ${result.amountPerTon}元/吨`;
                    if (result.amountPerLiterMin && result.amountPerLiterMax) {
                        detail += ` (${result.amountPerLiterMin}-${result.amountPerLiterMax}元/升)`;
                    } else if (result.amountPerLiterMin) {
                        detail += ` (${result.amountPerLiterMin}元/升)`;
                    }
                    parts.push(detail);
                }
            }
            result.rawText = parts.join('\n');
        }
    } catch (e) {
        console.log(`[油价查询] 解析预测信息失败: ${e}`);
    }

    return result;
}

// ============ 格式化涨跌符号 ============
function formatChange(change) {
    if (!change) return '';
    if (change.startsWith('+')) return `📈 涨 ${change.substring(1)} 元`;
    if (change.startsWith('-')) return `📉 跌 ${change.substring(1)} 元`;
    return `(${change})`;
}

// ============ 执行 ============
main();
