const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const API_KEY = process.env.GOOGLE_API_KEY;

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

// Chat 路由保持不变
app.post('/api/chat', async (req, res) => {
    if (!API_KEY) return res.status(500).json({ error: "API Key 未配置" });
    const { prompt, history, imageBase64 } = req.body;
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

// ------------------------------------------------------------------
// 重点修复: 绘图路由 (极速版)
// ------------------------------------------------------------------
app.post('/api/imagine', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "缺少提示词" });

    // 1. 优先尝试 Google Imagen 3 (如果你的 Key 有权限)
    if (API_KEY) {
        try {
            // 设置一个超短的超时，如果Google 3秒没反应或报错，立马切备用，防止卡死
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒限制

            const modelName = 'imagen-3.0-generate-001';
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${API_KEY}`;
            
            const response = await axios.post(url, {
                instances: [{ prompt: prompt }],
                parameters: { sampleCount: 1, aspectRatio: "1:1" }
            }, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const predictions = response.data.predictions;
            if (predictions && predictions.length > 0) {
                return res.json({ 
                    success: true, 
                    // Google 返回的是 Base64，可以直接用
                    image: `data:image/png;base64,${predictions[0].bytesBase64Encoded}`,
                    source: 'google'
                });
            }
        } catch (error) {
            console.log("Google Imagen 失败或超时，切换至极速模式...");
            // 忽略错误，直接向下执行备用逻辑
        }
    }

    // 2. 极速备用方案: 直接返回 URL，不经过服务器下载
    // 这样服务器响应时间 < 0.1秒，绝对不会超时
    try {
        const seed = Math.floor(Math.random() * 100000);
        // 对中文提示词进行简单的 URL 编码，最好是前端翻译成英文，但后端也做一层保护
        const safePrompt = encodeURIComponent(prompt);
        
        // 使用 Pollinations.ai 的直连 URL
        const imageUrl = `https://image.pollinations.ai/prompt/${safePrompt}?seed=${seed}&width=1024&height=1024&nologo=true&model=flux`;

        return res.json({
            success: true,
            image: imageUrl, // 前端 `img src` 可以直接加载这个 URL
            source: 'pollinations'
        });

    } catch (fallbackError) {
        return res.status(500).json({ success: false, error: "生成链接失败" });
    }
});

module.exports = app;