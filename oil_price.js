/*
 * 油价查询脚本 - 使用 ApiZero 接口
 * 功能：查询指定省份实时油价 + 下一轮调价预测
 * 数据源：https://v1.apizero.cn/api/oil-price-forecast
 * 默认：福建 95号汽油
 * 支持参数：省份,油品（如 "广东,92"）
 */

// ============ 油品映射 ============
const oilTypeMap = {
    '92': '92号汽油',
    '95': '95号汽油',
    '98': '98号汽油',
    '0h': '0号柴油'
};

// ApiZero 油品类型标识映射
const apiZeroTypeMap = {
    '92': 'gasoline_92',
    '95': 'gasoline_95',
    '98': 'gasoline_98',
    '0h': 'diesel_0'
};

const DEFAULT_PROVINCE = '福建';
const DEFAULT_OIL = '95';

// ============ 参数解析（兼容字符串/对象） ============
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
    } catch (e) {
        console.log('[油价] 参数解析异常，使用默认值');
    }
    if (province.includes('object')) province = DEFAULT_PROVINCE;
    if (oil.includes('object')) oil = DEFAULT_OIL;
    return { province, oil };
}

const params = parseArgument($argument);
const provinceName = params.province;
const oilType = params.oil;
const oilLabel = oilTypeMap[oilType] || oilType;

console.log(`[油价] 查询 ${provinceName} ${oilLabel}`);

// ============ 构建 ApiZero 请求 URL ============
// 接口文档：https://apizero.cn/aidocs/oil-price-forecast/raw.md
// 匿名调用每日 5000 次，无需 API Key
const API_URL = `https://v1.apizero.cn/api/oil-price-forecast?action=forecast&province=${encodeURIComponent(provinceName)}`;
console.log(`[油价] 请求: ${API_URL}`);

// ============ 主函数 ============
function main() {
    $httpClient.get({
        url: API_URL,
        timeout: 10,
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9'
        }
    }, (error, response, data) => {
        if (error) {
            $notification.post('⛽ 油价查询失败', provinceName, `网络错误\n${error}`);
            console.log(`[油价] 请求失败: ${error}`);
            $done();
            return;
        }

        if (response && response.statusCode !== 200) {
            $notification.post('⛽ 查询失败', provinceName, `HTTP ${response.statusCode}`);
            console.log(`[油价] HTTP状态码: ${response.statusCode}`);
            $done();
            return;
        }

        try {
            const json = JSON.parse(data);
            console.log(`[油价] API响应: ${JSON.stringify(json).substring(0, 300)}...`);

            // ApiZero 返回 code: 0 表示成功
            if (json.code !== 0) {
                $notification.post('⛽ 查询失败', provinceName, `API错误: ${json.msg || '未知'}`);
                $done();
                return;
            }

            const result = json.data;
            if (!result) {
                $notification.post('⛽ 查询失败', provinceName, '返回数据为空');
                $done();
                return;
            }

            // ----- 1. 提取指定油品价格 -----
            let price = null;
            const targetType = apiZeroTypeMap[oilType];
            if (result.prices && Array.isArray(result.prices)) {
                for (let p of result.prices) {
                    if (p.type === targetType) {
                        price = p.price;
                        break;
                    }
                }
                // 如果没匹配到，按名称匹配
                if (price === null) {
                    for (let p of result.prices) {
                        if (p.name && p.name.includes(oilLabel)) {
                            price = p.price;
                            break;
                        }
                    }
                }
            }

            // ----- 2. 提取调价预测信息 -----
            let forecastText = '';
            let nextDate = '';

            if (result.prediction) {
                const pred = result.prediction;
                const direction = pred.direction || '';
                const emoji = pred.direction_emoji || '';
                const perLiter = pred.estimated_change_per_liter;
                const perTon = pred.estimated_change_per_ton;

                let detail = '';
                if (perLiter !== undefined && perLiter !== null) {
                    const absVal = Math.abs(perLiter).toFixed(2);
                    if (perLiter > 0) {
                        detail = `预计上调 ${absVal} 元/升`;
                    } else if (perLiter < 0) {
                        detail = `预计下调 ${absVal} 元/升`;
                    } else {
                        detail = '预计搁浅';
                    }
                } else if (perTon !== undefined && perTon !== null) {
                    const absVal = Math.abs(perTon);
                    if (perTon > 0) {
                        detail = `预计上调 ${absVal} 元/吨`;
                    } else if (perTon < 0) {
                        detail = `预计下调 ${absVal} 元/吨`;
                    } else {
                        detail = '预计搁浅';
                    }
                }

                if (direction && detail) {
                    forecastText = `${emoji} ${direction}，${detail}`;
                } else if (direction) {
                    forecastText = `${emoji} ${direction}`;
                } else if (detail) {
                    forecastText = detail;
                }
            }

            // 下次调价日期
            if (result.next_adjust_date) {
                nextDate = `调价日期：${result.next_adjust_date}`;
            } else if (result.next_adjustment) {
                nextDate = result.next_adjustment;
            }

            // 分析摘要（如果有）
            let analysisText = '';
            if (result.prediction && result.prediction.analysis) {
                analysisText = result.prediction.analysis;
            }

            // ----- 3. 发送通知 -----
            if (price !== null && price !== undefined) {
                const title = `⛽ ${provinceName} ${oilLabel}`;
                let body = `当前价格：${price} 元/升`;

                // 如果有预测信息，追加到通知
                if (forecastText || nextDate) {
                    body += `\n---`;
                    if (nextDate) body += `\n📆 ${nextDate}`;
                    if (forecastText) body += `\n📊 ${forecastText}`;
                }

                // 如果有分析摘要，也加上（可能较长，截取前80字）
                if (analysisText) {
                    const shortAnalysis = analysisText.length > 80 ? analysisText.substring(0, 80) + '...' : analysisText;
                    body += `\n💡 ${shortAnalysis}`;
                }

                $notification.post(title, '📊 实时油价及预测', body);
                console.log(`[油价] 通知发送成功`);
            } else {
                // 如果没找到价格，返回完整数据便于调试
                $notification.post('⛽ 查询失败', provinceName, `未找到 ${oilLabel} 价格\n请检查油品参数（92/95/98/0h）`);
                console.log(`[油价] 未找到价格，完整数据: ${JSON.stringify(result)}`);
            }

        } catch (e) {
            $notification.post('⛽ 异常', provinceName, `数据解析失败\n${e.message}`);
            console.log(`[油价] 解析异常: ${e.stack}`);
        }
        $done();
    });
}

main();
