// Vercel Serverless Function — secure proxy for the Gemini API.
// The API key lives only on the server (process.env.GEMINI_API_KEY) and is
// never sent to the browser. The client talks only to /api/chat.

const MODEL = 'gemini-flash-latest'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'Server misconfiguration: missing GEMINI_API_KEY' })
  }

  // Vercel parses JSON bodies automatically, but be defensive.
  const payload = typeof req.body === 'string' ? safeParse(req.body) : req.body
  if (!payload || !Array.isArray(payload.contents)) {
    return res.status(400).json({ error: 'Invalid request body' })
  }

  try {
    const upstream = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    })

    // Forward Gemini's response unchanged (status + body), so the client's
    // existing response parsing keeps working.
    const data = await upstream.json().catch(() => null)

    if (!upstream.ok) {
      return res
        .status(upstream.status)
        .json(data || { error: `Gemini error: ${upstream.status}` })
    }

    return res.status(200).json(data)
  } catch {
    return res.status(502).json({ error: 'Failed to reach Gemini API' })
  }
}

function safeParse(str) {
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}
