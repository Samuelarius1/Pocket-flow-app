import { ArrowDownLeft, ArrowUpRight, Bot, ChartNoAxesCombined, CircleHelp, CreditCard, LayoutDashboard, Settings2, ShoppingBasket, Sparkles, Target } from 'lucide-react'

export type Section = 'overview' | 'accounts' | 'transactions' | 'budgets' | 'goals' | 'shopping' | 'insights' | 'settings'

const links = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', icon: ArrowDownLeft },
  { id: 'budgets', label: 'Budgets', icon: CreditCard },
  { id: 'goals', label: 'Savings goals', icon: Target },
  { id: 'shopping', label: 'Shopping list', icon: ShoppingBasket },
  { id: 'insights', label: 'Insights', icon: ChartNoAxesCombined },
] as const

export function Sidebar({ current, onNavigate, onAssistant, profileName = 'Your profile', avatar = null }: { current: Section; onNavigate: (section: Section) => void; onAssistant: () => void; profileName?: string; avatar?: string | null }) {
  const initials = profileName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'PF'
  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); onNavigate('overview') }} aria-label="PocketFlow home">
        <span className="brand-mark"><img src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/icon.ico-EKi0m8IUpfGjf7PpZ6tuFhp5uqSOZR.x-icon" alt="" /></span>
        <span className="brand-name">Pocket<span>Flow</span></span>
      </a>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        {links.map(({ id, label, icon: Icon }) => (
          <button key={id} className={`nav-link ${current === id ? 'active' : ''}`} onClick={() => onNavigate(id)} aria-current={current === id ? 'page' : undefined}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{id === 'transactions' && <span className="nav-count">12</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="assistant-card">
          <span className="assistant-orb"><Sparkles size={16} /></span>
          <div><strong>Your money, understood</strong><p>Meet My PF Assistant</p></div>
          <button aria-label="Open My PF Assistant" onClick={onAssistant}><Bot size={18} /></button>
        </div>
        <button className={`nav-link ${current === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')} aria-current={current === 'settings' ? 'page' : undefined}><Settings2 size={18} /><span>Settings</span></button>
        <button className="nav-link help-link" onClick={() => onNavigate('settings')}><CircleHelp size={18} /><span>Help & support</span></button>
        <div className="sidebar-profile">
          <div className="avatar avatar-small">{avatar ? <img src={avatar} alt="" /> : initials}</div>
          <div className="profile-meta"><strong>{profileName}</strong><span>Personal account</span></div>
          <ArrowUpRight size={15} className="profile-arrow" />
        </div>
      </div>
    </aside>
  )
}
