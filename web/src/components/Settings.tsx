import { useRef, useState } from 'react'
import { Bell, Check, ChevronRight, Download, Globe2, KeyRound, LockKeyhole, Monitor, Moon, ShieldCheck, Sun, Trash2, Upload, WalletCards } from 'lucide-react'
import type { Preferences } from '../offline-store'
import './Settings.css'
import { loadFinanceCategories, loadFinanceRecords } from '../finance-store'
import { loadShoppingItems } from '../shopping-store'

type Props = { preferences: Preferences; onChange: (value: Partial<Preferences>) => void; syncState: string; onSignIn: () => void }

export function Settings({ preferences, onChange, syncState, onSignIn }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [backupState, setBackupState] = useState('')
  const updateAvatar = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/') || file.size > 2_000_000) return
    const reader = new FileReader()
    reader.onload = () => onChange({ avatar: typeof reader.result === 'string' ? reader.result : null })
    reader.readAsDataURL(file)
  }
  const downloadBackup = async () => {
    setBackupState('Preparing your backup…')
    try {
      const resources = ['accounts', 'transactions', 'budgets', 'goals'] as const
      const [records, categories, shopping] = await Promise.all([
        Promise.all(resources.map((resource) => loadFinanceRecords(resource))),
        loadFinanceCategories(),
        loadShoppingItems(),
      ])
      const backup = {
        format: 'pocketflow-backup',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        preferences,
        records: Object.fromEntries(resources.map((resource, index) => [resource, records[index]])),
        categories,
        shopping: shopping.items,
      }
      const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `pocketflow-backup-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
      setBackupState('Backup downloaded. Keep the file somewhere private and secure.')
    } catch (error) {
      setBackupState(error instanceof Error ? error.message : 'Unable to prepare the backup. Sign in and try again.')
    }
  }
  return (
    <div className="settings-page">
      <div className="settings-intro"><p className="eyebrow">YOUR SPACE</p><h1>Settings</h1><p>Make PocketFlow feel like yours.</p></div>
      <div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections"><a className="settings-nav-item selected" href="#profile"><span className="settings-nav-icon"><Globe2 size={17} /></span>Personal details</a><a className="settings-nav-item" href="#preferences"><span className="settings-nav-icon"><Sun size={17} /></span>Preferences</a><a className="settings-nav-item" href="#notifications"><span className="settings-nav-icon"><Bell size={17} /></span>Notifications</a><a className="settings-nav-item" href="#privacy"><span className="settings-nav-icon"><ShieldCheck size={17} /></span>Privacy & security</a><a className="settings-nav-item" href="#connected"><span className="settings-nav-icon"><WalletCards size={17} /></span>Sync & connections</a><a className="settings-nav-item" href="#backup"><span className="settings-nav-icon"><Download size={17}/></span>Data & backup</a></nav>
        <div className="settings-content">
          <section className="settings-card" id="profile"><div className="settings-card-head"><div><h2>Personal details</h2><p>How you show up in PocketFlow.</p></div><span className="saved-indicator"><Check size={13} />{syncState === 'synced' ? 'Synced to account' : syncState === 'saving' ? 'Saving changes…' : 'Saved on this device'}</span></div><div className="profile-photo-row"><div className="profile-photo">{preferences.avatar ? <img src={preferences.avatar} alt="Your profile" /> : <span>{preferences.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'PF'}</span>}</div><div className="photo-copy"><strong>Your profile photo</strong><span>JPG, PNG or GIF · up to 2 MB</span><div className="photo-actions"><button className="button button-small" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload photo</button>{preferences.avatar && <button className="subtle-button" onClick={() => onChange({ avatar: null })}><Trash2 size={14} /> Remove</button>}<input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(event) => updateAvatar(event.target.files?.[0])} /></div></div></div><div className="field-grid"><label className="form-field"><span>Display name</span><input value={preferences.displayName} onChange={(event) => onChange({ displayName: event.target.value })} placeholder="Your name" autoComplete="name" /></label><label className="form-field"><span>Email address</span><input type="email" value={preferences.email} onChange={(event) => onChange({ email: event.target.value })} placeholder="you@example.com" autoComplete="email" /></label><label className="form-field"><span>Country</span><select value={preferences.country} onChange={(event) => onChange({ country: event.target.value })}><option>Uganda</option><option>Kenya</option><option>Tanzania</option><option>Rwanda</option><option>United States</option><option>United Kingdom</option><option>Other</option></select></label><label className="form-field"><span>Preferred currency</span><select value={preferences.currency} onChange={(event) => onChange({ currency: event.target.value })}><option value="UGX">UGX · Ugandan Shilling</option><option value="USD">USD · US Dollar</option><option value="EUR">EUR · Euro</option><option value="GBP">GBP · British Pound</option><option value="KES">KES · Kenyan Shilling</option><option value="TZS">TZS · Tanzanian Shilling</option></select></label><label className="form-field"><span>Language</span><select value={preferences.language} onChange={(event) => onChange({ language: event.target.value })}><option>English</option><option>Swahili</option><option>French</option></select></label></div></section>
          <section className="settings-card" id="preferences"><div className="settings-card-head"><div><h2>Appearance</h2><p>Choose what feels comfortable.</p></div></div><div className="theme-options" role="radiogroup" aria-label="Color theme">{([{id:'light', label:'Light', icon:Sun},{id:'dark',label:'Dark',icon:Moon},{id:'system',label:'System',icon:Monitor}] as const).map(({id,label,icon:Icon})=><button key={id} className={`theme-choice ${preferences.theme === id ? 'chosen' : ''}`} role="radio" aria-checked={preferences.theme === id} onClick={() => onChange({ theme: id })}><Icon size={18}/><span>{label}</span>{preferences.theme === id && <Check size={14} className="theme-check"/>}</button>)}</div></section>
          <section className="settings-card" id="notifications"><div className="settings-card-head"><div><h2>Notifications</h2><p>Stay in the loop, on your terms.</p></div></div><div className="setting-row"><div className="setting-icon"><Bell size={17}/></div><div className="setting-copy"><strong>Important updates</strong><span>Security notices, account changes, and product updates.</span></div><button className={`switch ${preferences.notifications ? 'on' : ''}`} role="switch" aria-checked={preferences.notifications} aria-label="Important updates" onClick={() => onChange({ notifications: !preferences.notifications })}><span/></button></div></section>
          <section className="settings-card" id="backup"><div className="settings-card-head"><div><h2>Data & backup</h2><p>Save a portable copy of your PocketFlow data.</p></div></div><div className="backup-action"><p>Includes finance records, categories, preferences, and your shopping list. The downloaded JSON file contains sensitive information; store it somewhere private.</p><button className="button button-primary" onClick={() => void downloadBackup()} disabled={backupState === 'Preparing your backup…'}><Download size={15}/>{backupState === 'Preparing your backup…' ? 'Preparing…' : 'Download backup'}</button>{backupState && <p role="status" className="finance-message">{backupState}</p>}</div></section>
          <section className="settings-card" id="privacy"><div className="settings-card-head"><div><h2>Privacy & security</h2><p>You&apos;re in control of what PocketFlow uses.</p></div></div><div className="setting-row"><div className="setting-icon"><LockKeyhole size={17}/></div><div className="setting-copy"><strong>Personalized insights</strong><span>Use your activity to surface relevant financial observations.</span></div><button className={`switch ${preferences.privacyInsights ? 'on' : ''}`} role="switch" aria-checked={preferences.privacyInsights} aria-label="Personalized insights" onClick={() => onChange({ privacyInsights: !preferences.privacyInsights })}><span/></button></div><button className="action-row" onClick={onSignIn}><span className="setting-icon"><KeyRound size={17}/></span><span className="setting-copy"><strong>Sign in to sync securely</strong><span>Sign in to your account to sync settings between devices.</span></span><ChevronRight size={17}/></button></section>
          <section className="settings-card" id="connected"><div className="settings-card-head"><div><h2>Sync & connections</h2><p>PocketFlow account sync works online and queues changes offline.</p></div></div><p className="connection-note">Direct bank or mobile money connections are not configured. You can still record transactions manually and sync them across devices.</p><button className="action-row" onClick={onSignIn}><span className="setting-icon"><WalletCards size={17}/></span><span className="setting-copy"><strong>PocketFlow account</strong><span>Sign in or create an account to sync your private data.</span></span><ChevronRight size={17}/></button></section>
          <div className="sync-footnote"><span className="sync-dot"/><span>{syncState === 'synced' ? 'Synced to your account' : syncState === 'offline' ? 'Offline · changes are saved on this device' : syncState === 'service-unavailable' ? 'Backend unavailable · saved on this device' : syncState === 'sign-in-required' ? 'Saved on this device · sign in to sync across devices' : 'Changes save automatically'}</span><button onClick={onSignIn}>Account & sync</button></div>
        </div>
      </div>
    </div>
  )
}
