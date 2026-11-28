import { apiFetch } from '../api'
import { useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, ShieldCheck, X } from 'lucide-react'

export type AccountUser = { id: string; email: string; displayName: string }

export function AccountDialog({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated: (user: AccountUser) => void | Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      })
      const result = await response.json().catch(() => ({})) as AccountUser & { error?: string }
      if (!response.ok) throw new Error(result.error || 'The PocketFlow account service is not available right now.')
      await onAuthenticated(result)
      setSuccess(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect right now. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title"><button className="modal-close" aria-label="Close" onClick={onClose}><X size={18}/></button><div className="modal-icon"><ShieldCheck size={21}/></div><p className="eyebrow">SECURE BY DESIGN</p><h2 id="account-title">{success ? 'Your settings can travel with you.' : mode === 'register' ? 'Create your PocketFlow account' : 'Welcome back'}</h2>{success ? <><p>Your account is ready. Preferences and saved records sync securely across your devices whenever you are online.</p><button className="button button-primary" onClick={onClose}>Continue to PocketFlow <ArrowRight size={15}/></button></> : <><p>{mode === 'register' ? 'Create an account to keep your preferences in sync across devices.' : 'Sign in to sync your PocketFlow preferences.'}</p><form className="account-form" onSubmit={(event) => void submit(event)}>{mode === 'register' && <label className="form-field"><span>Display name</span><input required maxLength={100} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name"/></label>}<label className="form-field"><span>Email address</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label><label className="form-field"><span>Password {mode === 'register' && <small>(12 characters minimum)</small>}</span><input required minLength={mode === 'register' ? 12 : 1} maxLength={72} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••"/></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary account-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'} <ArrowRight size={15}/></button></form><button className="account-mode-toggle" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError('') }}>{mode === 'register' ? 'Already have an account? Sign in' : 'New to PocketFlow? Create an account'}</button><p className="account-security"><KeyRound size={12}/> Passwords are protected with bcrypt. Sessions use secure, HTTP-only cookies.</p></>}</section></div>
}
