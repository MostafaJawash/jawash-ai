import { useState, useRef, useEffect } from 'react'
import { loadConversations, saveConversations } from './storage'

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const MODEL = 'gemini-flash-lite-latest'
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
const LEGACY_KEY = 'jawash-conversations' // للترحيل من الإصدار القديم (localStorage)

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(16).slice(2)
}

function createConversation() {
  return { id: newId(), title: 'محادثة جديدة', messages: [] }
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      resolve({
        name: file.name,
        mimeType: file.type,
        data: result.split(',')[1],
        url: result,
      })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function App() {
  // يبدأ دائمًا بمحادثة جديدة فارغة؛ المحادثات المحفوظة تُضاف بعد التحميل
  const [initialConversation] = useState(createConversation)
  const [conversations, setConversations] = useState(() => [initialConversation])
  const [activeId, setActiveId] = useState(initialConversation.id)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [storageWarning, setStorageWarning] = useState(false)
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)
  const loadedRef = useRef(false)

  const activeConversation =
    conversations.find((c) => c.id === activeId) || conversations[0]
  const messages = activeConversation?.messages || []

  // تحميل المحادثات المحفوظة من IndexedDB عند الفتح (مع ترحيل بيانات localStorage القديمة)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let saved = await loadConversations()
      if (!saved.length) {
        try {
          const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY))
          if (Array.isArray(legacy) && legacy.length) {
            saved = legacy
            await saveConversations(legacy)
            localStorage.removeItem(LEGACY_KEY)
          }
        } catch { /* ignore */ }
      }
      if (cancelled) return
      // نبقي المحادثة الجديدة الفارغة في الأعلى، ونضيف المحفوظة (غير الفارغة) بعدها
      const restored = saved.filter((c) => c.messages && c.messages.length)
      setConversations([initialConversation, ...restored])
      loadedRef.current = true
    })()
    return () => {
      cancelled = true
    }
  }, [initialConversation])

  // حفظ فوري في IndexedDB عند أي تغيير (نتجاهل المحادثات الفارغة)
  useEffect(() => {
    if (!loadedRef.current) return
    const toSave = conversations.filter((c) => c.messages && c.messages.length)
    saveConversations(toSave)
      .then(() => setStorageWarning(false))
      .catch(() => setStorageWarning(true))
  }, [conversations])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function updateActive(updater) {
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? updater(c) : c))
    )
  }

  function newConversation() {
    setQuestion('')
    setImages([])
    setError(null)
    setSidebarOpen(false)
    // لو المحادثة الحالية فارغة أصلًا، نكتفي بها بدل إنشاء أخرى فارغة
    if (activeConversation && activeConversation.messages.length === 0) return
    const conv = createConversation()
    setConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
  }

  function selectConversation(id) {
    setActiveId(id)
    setError(null)
    setSidebarOpen(false)
  }

  function deleteConversation(id, e) {
    e.stopPropagation()
    const filtered = conversations.filter((c) => c.id !== id)
    if (filtered.length === 0) {
      const conv = createConversation()
      setConversations([conv])
      setActiveId(conv.id)
    } else {
      setConversations(filtered)
      if (id === activeId) setActiveId(filtered[0].id)
    }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith('image/')
    )
    if (files.length) {
      const imgs = await Promise.all(files.map(fileToImage))
      setImages((prev) => [...prev, ...imgs])
    }
    e.target.value = ''
  }

  function removeImage(index) {
    setImages((prev) => prev.filter((_, i) => i !== index))
  }

  async function askAI(e) {
    e.preventDefault()
    const q = question.trim()
    if ((!q && images.length === 0) || loading) return

    if (!API_KEY) {
      setError('لم يتم العثور على مفتاح API. تأكد من ملف .env')
      return
    }

    const attached = images
    const userMsg = {
      role: 'user',
      text: q,
      images: attached.map((im) => im.url),
    }

    updateActive((c) => ({
      ...c,
      title:
        c.messages.length === 0
          ? q
            ? q.slice(0, 40)
            : 'صورة'
          : c.title,
      messages: [...c.messages, userMsg],
    }))

    setQuestion('')
    setImages([])
    setLoading(true)
    setError(null)

    try {
      const parts = []
      if (q) parts.push({ text: q })
      for (const img of attached) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': API_KEY,
        },
        body: JSON.stringify({ contents: [{ parts }] }),
      })

      if (!response.ok) {
        throw new Error(`خطأ من الخادم: ${response.status}`)
      }

      const data = await response.json()
      const answer =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ??
        'لم يتم الحصول على رد.'

      updateActive((c) => ({
        ...c,
        messages: [...c.messages, { role: 'model', text: answer }],
      }))
    } catch (err) {
      setError(err.message || 'حدث خطأ أثناء الاتصال بالنموذج')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="layout">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-head">
          <span className="sidebar-title">المحادثات</span>
          <button
            className="icon-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        <button className="new-chat" onClick={newConversation}>
          + محادثة جديدة
        </button>

        <div className="conv-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => selectConversation(c.id)}
            >
              <span className="conv-name">{c.title || 'محادثة جديدة'}</span>
              <button
                className="conv-del"
                onClick={(e) => deleteConversation(c.id, e)}
                aria-label="حذف المحادثة"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      </aside>

      {sidebarOpen && (
        <div className="backdrop" onClick={() => setSidebarOpen(false)} />
      )}

      {!sidebarOpen && (
        <button
          className="side-toggle"
          onClick={() => setSidebarOpen(true)}
          aria-label="فتح القائمة"
        >
          ☰
        </button>
      )}

      <div className="app">
        <header className="header">
          <img
            className="header-logo"
            src="/jawash_ai_logo_v2.svg"
            alt="Jawash AI"
          />
          <p>مساعدك الذكي </p>
        </header>

        {storageWarning && (
          <div className="storage-warning">
            تعذّر حفظ المحادثات على جهازك. قد تكون مساحة التخزين ممتلئة أو أن
            المتصفح يمنع التخزين في وضع التصفح الخفي.
          </div>
        )}

        <main className="chat">
          {messages.length === 0 && !loading && (
            <div className="empty">اكتب سؤالك وابدأ المحادثة</div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              <span className="bubble-label">
                {m.role === 'user' ? 'أنت' : 'Jawash AI'}
              </span>
              {m.images && m.images.length > 0 && (
                <div className="bubble-images">
                  {m.images.map((src, idx) => (
                    <img key={idx} src={src} alt="" />
                  ))}
                </div>
              )}
              {m.text && <p>{m.text}</p>}
            </div>
          ))}

          {loading && (
            <div className="bubble model loading">
              <span className="bubble-label">Jawash AI</span>
              <p className="dots">
                <span></span>
                <span></span>
                <span></span>
              </p>
            </div>
          )}

          {error && <div className="error">{error}</div>}
          <div ref={bottomRef} />
        </main>

        <form className="composer" onSubmit={askAI}>
          {images.length > 0 && (
            <div className="attachments">
              {images.map((img, i) => (
                <div className="attachment" key={i}>
                  <img src={img.url} alt={img.name} />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label="إزالة الصورة"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-row">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              aria-label="تحميل صورة"
            >
              <span className="attach-icon">⬆</span>
              تحميل
            </button>
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              ref={fileInputRef}
              onChange={handleFiles}
            />
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="اكتب سؤالك هنا..."
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || (!question.trim() && images.length === 0)}
            >
              إرسال
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
