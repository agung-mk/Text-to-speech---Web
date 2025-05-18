const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory cache for audio files
const audioCache = new Map();

// Generate a unique code for the audio URL
function generateAudioCode(url) {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    return hash.substring(0, 10); // Using 10 characters for the code
}

// Proxy endpoint to serve the actual audio files
app.get('/audio/:code', async (req, res) => {
    const { code } = req.params;
    
    if (!audioCache.has(code)) {
        return res.status(404).json({ 
            success: false,
            error: 'Audio file not found' 
        });
    }

    const audioUrl = audioCache.get(code);
    
    try {
        const response = await axios.get(audioUrl, {
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        
        // Set appropriate content type
        res.set('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        response.data.pipe(res);
    } catch (error) {
        console.error('Proxy audio error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error fetching audio file' 
        });
    }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Tmpfile uploader
const uploadToTmpfile = async (buffer) => {
  try {
    const form = new FormData();
    form.append('file', buffer, 'voicegen.mp3'); // Hardcode as MP3 since we know the response will be audio
    
    const response = await axios.post("https://tmpfiles.org/api/v1/upload", form, {
      headers: {
        ...form.getHeaders(),
        "accept": "*/*",
        "referer": "https://tmpfiles.org/",
      }
    });

    if (!response.data || !response.data.data || !response.data.data.url) {
      throw new Error('Upload failed');
    }

    return {
      success: true,
      url: response.data.data.url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/')
    };
  } catch (error) {
    console.error('Upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// API endpoint for TTS
app.post('/api/generate-tts', async (req, res) => {
  try {
    const { text, voice, vibe, prompt } = req.body;

    // Validate text length
    if (text.length > 1003) {
      return res.status(400).json({
        success: false,
        error: "Text exceeds maximum length of 1003 characters"
      });
    }

    const formData = new FormData();
    formData.append('input', text);
    formData.append('prompt', Object.entries(prompt)
      .map(([key, value]) => `${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`)
      .join('\n\n'));
    formData.append('voice', voice.toLowerCase());
    formData.append('vibe', vibe);

    const response = await axios.post(
      'https://www.openai.fm/api/generate',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'origin': 'https://www.openai.fm',
          'referer': 'https://www.openai.fm/'
        },
        responseType: 'arraybuffer'
      }
    );

    // Upload to tmpfile
    const uploadResult = await uploadToTmpfile(Buffer.from(response.data));
    if (!uploadResult.success) {
      throw new Error('Failed to upload audio: ' + uploadResult.error);
    }

    // Generate local URL
    const code = generateAudioCode(uploadResult.url);
    audioCache.set(code, uploadResult.url);
    
    const host = req.get('host');
    const protocol = req.protocol;
    const localUrl = `${protocol}://${host}/audio/${code}`;

    res.json({
      success: true,
      audioUrl: localUrl,
      params: {
        text,
        voice,
        vibe,
        prompt
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
});

// Serve index page
app.get('/', (req, res) => {
  res.render('index', {
    voices: ['Alloy', 'Ash', 'Ballad', 'Coral', 'Echo', 'Fable', 'Onyx', 'Nova', 'Sage', 'Shimmer', 'Verse'],
    vibes: ['Santa', 'True Crime Buff', 'Old-Timey', 'Robot', 'Eternal Optimist'],
    defaultPrompt: {
      identity: 'A professional speaker',
      affect: 'Authoritative and friendly, displaying a wise and measured tone',
      tone: 'Professional and formal, easy to understand and acceptable',
      emotion: 'Confident and inspiring, conveying messages clearly',
      pronunciation: 'Clear and precise, with good articulation',
      pause: 'Strategic pauses for emphasis and to give listeners time to digest key points'
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
