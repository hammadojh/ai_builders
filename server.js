import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Readable } from 'stream';

// Load environment variables from .env file
dotenv.config();

// Initialize API clients
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Define the port to run the server on
const PORT = 3000;

// Get __dirname equivalent in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize conversation history for each agent
let conversationHistory = {};

// Initialize agent contexts
let agentContexts = {};

// Initialize agent models
let agentModels = {
    1: 'claude' // Set Agent 1 to use Claude by default
};

// Initialize personality storage
let agentPersonalities = {};

// Add this near the top of server.js, after the imports
const personalities = {
    witty: "You are witty and sarcastic, often making clever observations with a hint of playful mockery.",
    formal: "You are extremely formal and professional, speaking like a distinguished academic or diplomat.",
    casual: "You are super casual and laid-back, using informal language and speaking like a close friend.",
    poetic: "You are poetic and romantic, often speaking in metaphors and flowery language.",
    nerdy: "You are a tech enthusiast who loves making references to science, gaming, and pop culture.",
    philosophical: "You are deeply philosophical, always trying to explore the deeper meaning of conversations.",
    dramatic: "You are theatrical and dramatic, treating every interaction like it's a scene from a play.",
    optimistic: "You are extremely positive and encouraging, always finding the bright side of things.",
    mysterious: "You are enigmatic and mysterious, speaking in riddles and cryptic statements.",
    rebellious: "You are a nonconformist who questions everything and challenges conventional wisdom."
};

// Add this after your other initializations
const voices = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
let agentVoices = {
    1: 'nova',    // Default voice for first agent
    2: 'fable'    // Default voice for second agent
};

// Create the server
const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
        // Serve the index.html file
        const filePath = path.join(__dirname, 'index.html');
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server Error');
        }
    } else if (req.method === 'POST' && req.url === '/chat') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            const { message, agentId, agentCount } = JSON.parse(body);
            if (!conversationHistory[agentId]) {
                conversationHistory[agentId] = [];
            }
            try {
                await streamOpenAIResponse(message, agentId, agentCount, res);
            } catch (error) {
                console.error('Error fetching response:', error.message);
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                }
                res.end(JSON.stringify({ error: 'Error fetching response' }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/train') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            const { agentId, context } = JSON.parse(body);
            agentContexts[agentId] = context;
            
            // Clear previous conversation history for this agent
            conversationHistory[agentId] = [];
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    } else if (req.method === 'POST' && req.url === '/toggle-model') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            const { agentId } = JSON.parse(body);
            // Toggle between 'gpt' and 'claude'
            agentModels[agentId] = agentModels[agentId] === 'gpt' ? 'claude' : 'gpt';
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ model: agentModels[agentId] }));
        });
    } else if (req.method === 'POST' && req.url === '/set-personality') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            const { agentId, personality } = JSON.parse(body);
            agentPersonalities[agentId] = personality;
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    } else if (req.method === 'POST' && req.url === '/speak') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            const { text, agentId } = JSON.parse(body);
            try {
                // Use the agent's assigned voice, or fallback to 'alloy'
                const voice = agentVoices[agentId] || 'alloy';
                
                const mp3Response = await openai.audio.speech.create({
                    model: "tts-1",
                    voice: voice,
                    input: text,
                });

                // Get the audio data as a buffer
                const audioBuffer = Buffer.from(await mp3Response.arrayBuffer());

                // Set headers for audio streaming
                res.writeHead(200, {
                    'Content-Type': 'audio/mpeg',
                    'Content-Length': audioBuffer.length
                });

                // Create a readable stream from the buffer and pipe it to response
                const stream = Readable.from(audioBuffer);
                stream.pipe(res);
            } catch (error) {
                console.error('TTS error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Text-to-speech failed' }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// Function to stream response from OpenAI API
async function streamOpenAIResponse(message, agentId, agentCount, res, isSelfResponse = false) {
    if (!conversationHistory[agentId]) {
        conversationHistory[agentId] = [];
    }
    conversationHistory[agentId].push({ role: "user", content: message });

    const messages = conversationHistory[agentId].map((msg, index) => ({
        role: msg.role,
        content: msg.content
    }));

    const agentContext = agentContexts[agentId] || '';
    const personalityContext = agentPersonalities[agentId] ? 
        personalities[agentPersonalities[agentId]] : '';
    
    // Get current canvas content from the message if it's included
    const canvasContent = message.includes('Current canvas content:') ? 
        message.split('Current canvas content:')[1].trim() : 
        null;
    
    const systemMessage = `Agent ${agentId}, you are part of a group chat with ${agentCount} agents. 
        ${personalityContext ? personalityContext : ''}
        ${agentContext ? `Your context is: ${agentContext}` : ''}

        ${canvasContent ? `
        You are working collaboratively to achieve a specific goal. The current code:
        ${canvasContent.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')}
        
        When providing code changes:
        1. Specify the exact line numbers where your code should be inserted
        2. Provide the complete code that should go at that location
        3. You can specify multiple insertions if needed
        ` : 'The canvas is empty. Start with basic HTML structure that moves towards the goal.'}

        IMPORTANT: You must ALWAYS respond in the following JSON format wrapped in triple backticks:
        \`\`\`json
        {
            "text": "Your conversational response (max 64 characters)",
            "changes": [
                {
                    "line": 5,
                    "code": "your code here"
                },
                {
                    "line": 10,
                    "code": "another piece of code"
                }
            ]
        }
        \`\`\`

        Rules:
        1. The "text" field explains your changes
        2. The "changes" array contains all code modifications:
           - "line": the line number where code should be inserted
           - "code": the code to insert at that line
        3. Line numbers start at 1
        4. For empty canvas, use line 1
        5. Keep responses concise and natural

        Example response:
        \`\`\`json
        {
            "text": "Added a form with input fields",
            "changes": [
                {
                    "line": 5,
                    "code": "<form class='mt-4'>"
                },
                {
                    "line": 6,
                    "code": "  <input type='text' placeholder='Name' class='p-2'>"
                }
            ]
        }
        \`\`\``;

    try {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        
        if (agentModels[agentId] === 'claude') {
            const stream = await anthropic.messages.create({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 1000,
                messages: [{ role: 'user', content: message }],
                system: systemMessage,
                stream: true,
            });

            let fullResponse = '';
            // Collect the full response first
            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta') {
                    fullResponse += chunk.delta.text;
                }
            }
            
            // Try to parse the JSON response
            try {
                // Find the JSON content between triple backticks
                const jsonMatch = fullResponse.match(/```json\n([\s\S]*?)\n```/);
                if (jsonMatch) {
                    const jsonContent = jsonMatch[1];
                    const parsedResponse = JSON.parse(jsonContent);
                    
                    // Stream the parsed response
                    res.write(JSON.stringify(parsedResponse));
                } else {
                    // Fallback if no valid JSON found
                    res.write(JSON.stringify({
                        text: "Invalid response format",
                        code: null
                    }));
                }
            } catch (error) {
                console.error('JSON parsing error:', error);
                res.write(JSON.stringify({
                    text: "Error parsing response",
                    code: null
                }));
            }
            
            conversationHistory[agentId].push({ 
                role: "assistant", 
                content: fullResponse 
            });

        } else {
            const stream = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [...messages, { role: "system", content: systemMessage }],
                max_tokens: 1000,
                stream: true,
            });

            let fullResponse = '';
            // Collect the full response first
            for await (const chunk of stream) {
                const text = chunk.choices[0]?.delta?.content || '';
                fullResponse += text;
            }

            // Try to parse the JSON response
            try {
                // Find the JSON content between triple backticks
                const jsonMatch = fullResponse.match(/```json\n([\s\S]*?)\n```/);
                if (jsonMatch) {
                    const jsonContent = jsonMatch[1];
                    const parsedResponse = JSON.parse(jsonContent);
                    
                    // Stream the parsed response
                    res.write(JSON.stringify(parsedResponse));
                } else {
                    // Fallback if no valid JSON found
                    res.write(JSON.stringify({
                        text: "Invalid response format",
                        code: null
                    }));
                }
            } catch (error) {
                console.error('JSON parsing error:', error);
                res.write(JSON.stringify({
                    text: "Error parsing response",
                    code: null
                }));
            }

            conversationHistory[agentId].push({ 
                role: "assistant", 
                content: fullResponse 
            });
        }

        res.end();
    } catch (error) {
        console.error('API error:', error);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Failed to fetch response from API' }));
    }
}

// Start the server
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
