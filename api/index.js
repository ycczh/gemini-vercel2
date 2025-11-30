const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// 允许跨域
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const API_KEY = process.env.GOOGLE_API_KEY;

// 统一错误处理
const handleApiError = (error, res) => {
    console.error("API Error:", error.response?.data || error.message);
    res.status(500).json({
        success: false,
        error: error.response?.data?.error?.message || error.message || "服务器内部错误"
    });
};

app.get('/api', (req, res) => {
    res.send('Gemini Vercel Proxy is Running! 🚀');
});

// ------------------------------------------
// 路由: 聊天 (使用 Gemini)
// ------------------------------------------
app.post('/api/chat', async (req, res) => {
    if (!API_KEY) return res.status(500).json({ error: "API Key 未配置" });

    const { prompt, history, imageBase64 } = req.body;
    // 建议使用 flash 模型，速度快且免费额度高，容错率好
    const modelName = 'gemini-1.5-flash'; 

    try {
        const contents = [];
        if (history && Array.isArray(history)) {
            history.forEach(msg => {
                contents.push({
                    role: msg.role === 'ai' ? 'model' : 'user',
                    parts: [{ text: msg.text }]
                });
            });
        }

        const currentParts = [{ text: prompt || " " }];
        if (imageBase64) {
            // 简单的 Base64 清洗
            const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            currentParts.push({
                inline_data: { mime_type: "image/jpeg", data: cleanBase64 }
            });
        }
        contents.push({ role: 'user', parts: currentParts });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;
        
        const response = await axios.post(url, {
            contents: contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        });

        const aiText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "无回复";
        res.json({ success: true, text: aiText });

    } catch (error) {
        handleApiError(error, res);
    }
});

// ------------------------------------------
// 路由: 绘图 (Google Imagen 3 -> 自动降级 -> 开源引擎)
// ------------------------------------------
app.post('/api/imagine', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "缺少提示词" });

    // 1. 优先尝试 Google Imagen 3
    if (API_KEY) {
        try {
            console.log("尝试使用 Google Imagen 3...");
            const modelName = 'imagen-3.0-generate-001';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${API_KEY}`;
            
            const response = await axios.post(url, {
                instances: [{ prompt: prompt }],
                parameters: { sampleCount: 1, aspectRatio: "1:1" }
            });

            const predictions = response.data.predictions;
            if (predictions && predictions.length > 0) {
                return res.json({ 
                    success: true, 
                    image: `data:image/png;base64,${predictions[0].bytesBase64Encoded}`,
                    source: 'google'
                });
            }
        } catch (error) {
            console.log("Google Imagen 权限不足或失败，正在切换至备用引擎...");
            // 这里不 return，直接继续向下执行备用逻辑
        }
    }

    // 2. 备用方案: 使用 Pollinations AI (免费、无需 Key、无限次)
    try {
        console.log("正在使用备用引擎生成...");
        // 构建请求 URL (自动翻译提示词以获得更好效果是最好的，但这里直接用)
        // 为了稳定，我们添加一个随机种子
        const seed = Math.floor(Math.random() * 10000);
        const safePrompt = encodeURIComponent(prompt);
        const fallbackUrl = `https://image.pollinations.ai/prompt/${safePrompt}?seed=${seed}&width=1024&height=1024&nologo=true`;

        // 下载图片并转换为 Base64，以保持与前端接口一致
        const imageResponse = await axios.get(fallbackUrl, {
            responseType: 'arraybuffer',
            timeout: 15000 // 15秒超时
        });

        const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
        const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';

        return res.json({
            success: true,
            image: `data:${mimeType};base64,${base64Image}`,
            source: 'backup-engine'
        });

    } catch (fallbackError) {
        console.error("备用引擎也失败了:", fallbackError.message);
        return res.status(500).json({ 
            success: false, 
            error: "所有绘图引擎均繁忙，请稍后再试。" 
        });
    }
});

module.exports = app;
