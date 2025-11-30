const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// 允许跨域
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 从环境变量获取 Key (稍后在 Vercel 网页上设置)
const API_KEY = process.env.GOOGLE_API_KEY;

// 统一错误处理
const handleApiError = (error, res) => {
    console.error("API Error:", error.response?.data || error.message);
    res.status(500).json({
        success: false,
        error: error.response?.data?.error?.message || error.message || "服务器内部错误"
    });
};

// 路由: 根路径检查
app.get('/api', (req, res) => {
    res.send('Gemini Vercel Proxy is Running! 🚀');
});

// 路由: 聊天
app.post('/api/chat', async (req, res) => {
    if (!API_KEY) return res.status(500).json({ error: "API Key 未配置" });

    const { prompt, history, imageBase64 } = req.body;
    const modelName = 'gemini-1.5-pro'; // 推荐使用 1.5 pro

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
        
        // Vercel 服务器在美国，不需要代理
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

// 路由: 绘图
app.post('/api/imagine', async (req, res) => {
    if (!API_KEY) return res.status(500).json({ error: "API Key 未配置" });

    const { prompt, aspectRatio } = req.body;
    const modelName = 'imagen-3.0-generate-001';

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict?key=${API_KEY}`;
        
        const response = await axios.post(url, {
            instances: [{ prompt: prompt }],
            parameters: { sampleCount: 1, aspectRatio: aspectRatio || "1:1" }
        });

        const predictions = response.data.predictions;
        if (predictions && predictions.length > 0) {
            res.json({ success: true, image: `data:image/png;base64,${predictions[0].bytesBase64Encoded}` });
        } else {
            throw new Error("生成失败，无数据返回");
        }

    } catch (error) {
        // Imagen 可能需要白名单或特定权限，404 通常意味着账号无权限
        if (error.response?.status === 404) {
            return res.status(404).json({ success: false, error: "您的 API Key 可能暂无 Imagen 3 权限，或模型名称错误。" });
        }
        handleApiError(error, res);
    }
});

// 导出 app 供 Vercel 使用
module.exports = app;