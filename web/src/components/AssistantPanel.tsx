import { ArrowUp, Bot, Clock3, MoreHorizontal, Plus, Sparkles, X } from 'lucide-react'
import { useState } from 'react'

const suggestions = ['Where is my money going?', 'Help me build a budget', 'How can I save more?']

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [notice, setNotice] = useState('')
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!question.trim()) return
    setNotice('Connect an AI provider in Settings to get a personalized answer. Your financial information is not sent anywhere until you choose a provider.')
  }
  return <div className="assistant-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="assistant-panel" aria-label="My PF Assistant"><header className="assistant-header"><div className="assistant-title"><span className="assistant-logo"><Sparkles size={17}/></span><div><strong>My PF Assistant</strong><span><i/> Ready when you are</span></div></div><div className="assistant-tools"><button aria-label="Conversation history"><Clock3 size={17}/></button><button aria-label="New conversation" onClick={() => { setQuestion(''); setNotice('') }}><Plus size={18}/></button><button aria-label="Close assistant" onClick={onClose} className="assistant-close"><X size={18}/></button></div></header><div className="assistant-body"><div className="assistant-welcome"><div className="assistant-welcome-mark"><Bot size={25}/><span><Sparkles size={13}/></span></div><p className="eyebrow">A LITTLE MORE CLARITY</p><h2>Money questions<br/>are good questions.</h2><p className="assistant-description">When you connect an AI provider, I can help you understand your financial picture. You stay in control of what gets shared.</p></div><div className="suggestion-heading"><span>TRY ASKING</span><button aria-label="More suggestions"><MoreHorizontal size={16}/></button></div><div className="suggestion-list">{suggestions.map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}<ArrowUp size={14}/></button>)}</div>{notice && <div className="assistant-note" role="status">{notice}</div>}</div><form className="assistant-composer" onSubmit={submit}><textarea aria-label="Ask My PF Assistant" placeholder="Ask about your money…" value={question} onChange={(event) => setQuestion(event.target.value)} rows={2}/><div className="composer-footer"><span><i/> Provider not connected</span><button className="send-button" aria-label="Send question" disabled={!question.trim()}><ArrowUp size={17}/></button></div></form><p className="assistant-disclaimer">Your data stays yours. Connect a provider to begin.</p></aside></div>
}
