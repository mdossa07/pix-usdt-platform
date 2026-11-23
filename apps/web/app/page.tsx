'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { apiRequest } from '../lib/api';
import {
  Activity, ArrowDownLeft, ArrowDownRight, ArrowUpRight, BadgeCheck, Bell, BookOpen,
  ChevronDown, CircleHelp, Clock3, Copy, CreditCard, ExternalLink,
  FileText, LayoutDashboard, LifeBuoy, LockKeyhole, LogOut, Plus,
  Search, Settings, ShieldCheck, Wallet, Zap,
} from 'lucide-react';

type Operation = { id: string; date: string; amount: string; usdt: string; commission: string; status: string; wallet: string; };
type WalletEntry = { id?: string; exchange: string; network: string; address: string; state: string; primary: boolean; };
type ApiWallet = { id: string; label: string; exchangeName: string; networkCode: string; address: string; status: string; isDefault: boolean; };
type ApiTotals = { paymentsTotal: number; volumeBrlCents: string; completed: number; commissionUsdt: string; merchantNetUsdt: string; wallets: number; merchants?: number; pendingKyc?: number };
const initialOperations: Operation[] = [
  { id: 'PS-000184', date: 'Hoje, 14:32', amount: 'R$ 2.500,00', usdt: '450,000000', commission: '9,000000', status: 'Aguardando PIX', wallet: 'Binance · TRON' },
  { id: 'PS-000183', date: 'Hoje, 13:58', amount: 'R$ 850,00', usdt: '153,000000', commission: '3,060000', status: 'Concluída (demo)', wallet: 'OKX · Polygon' },
  { id: 'PS-000182', date: 'Hoje, 12:41', amount: 'R$ 1.200,00', usdt: '216,000000', commission: '4,320000', status: 'Em análise', wallet: 'Binance · TRON' },
  { id: 'PS-000181', date: 'Ontem, 18:06', amount: 'R$ 420,00', usdt: '75,600000', commission: '1,512000', status: 'Concluída (demo)', wallet: 'Bybit · Polygon' },
];
const nav = [
  { label: 'Visão geral', icon: LayoutDashboard }, { label: 'Operações', icon: Activity },
  { label: 'Carteiras', icon: Wallet }, { label: 'Integração API', icon: Zap },
  { label: 'Relatórios', icon: FileText },
];

export default function HomePage() {
  const [active, setActive] = useState('Visão geral');
  const [amount, setAmount] = useState('1000');
  const [network, setNetwork] = useState('TRON (TRC-20)');
  const [exchange, setExchange] = useState('Binance');
  const [wallet, setWallet] = useState('');
  const [walletHolder, setWalletHolder] = useState('');
  const [walletHolderTaxId, setWalletHolderTaxId] = useState('');
  const [walletType, setWalletType] = useState('HOSTED');
  const [vaspCountry, setVaspCountry] = useState('');
  const [apiConnected, setApiConnected] = useState(false);
  const [currentUser, setCurrentUser] = useState('Administrador');
  const [currentRole, setCurrentRole] = useState('SUPER_ADMIN');
  const [apiTotals, setApiTotals] = useState<ApiTotals | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const [operations, setOperations] = useState(initialOperations);
  const [wallets, setWallets] = useState<WalletEntry[]>([
    { exchange: 'Binance', network: 'TRON (TRC-20)', address: 'TQ9...x8Qp', state: 'Verificação pendente (demo)', primary: true },
    { exchange: 'OKX', network: 'Polygon', address: '0x71...f92A', state: 'Verificada (demo)', primary: false },
  ]);
  const [search, setSearch] = useState('');

  const amountNumber = Number(amount || 0);
  const indicativeUsdt = useMemo(() => (amountNumber * 0.18).toFixed(2), [amountNumber]);
  const commission = useMemo(() => (Number(indicativeUsdt) * 0.02).toFixed(2), [indicativeUsdt]);
  const net = useMemo(() => (Number(indicativeUsdt) - Number(commission)).toFixed(2), [indicativeUsdt, commission]);

  async function createMockOperation() {
    if (!Number.isFinite(amountNumber) || amountNumber < 5) { setNotice('Informe um valor mínimo de R$ 5,00.'); return; }
    const token = localStorage.getItem('pixsplit_token');
    if (token) {
      const selectedWallet = wallets.find(w => w.primary) ?? wallets[0];
      if (!selectedWallet?.id) { setNotice('Cadastre uma carteira pela sua conta antes de criar a cobrança.'); setActive('Carteiras'); setShowCreate(false); return; }
      try {
        const response = await apiRequest<{ externalId: string; warning: string }>('/v1/payments', { method: 'POST', body: JSON.stringify({ amountBrlCents: Math.round(amountNumber * 100), walletId: selectedWallet.id }) }, token);
        await refreshConnectedData(token);
        setNotice(`${response.externalId} criada. ${response.warning}`);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível criar a cobrança.'); return; }
    } else {
      if (!wallet.trim()) { setNotice('Informe um endereço de carteira para a demonstração.'); return; }
      const next: Operation = {
        id: `PS-${String(operations.length + 185).padStart(6, '0')}`,
        date: 'Agora', amount: amountNumber.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        usdt: indicativeUsdt, commission, status: 'PIX simulado — não pagável', wallet: `${exchange} · ${network}`,
      };
      setOperations([next, ...operations]);
      setNotice(`Operação ${next.id} criada em demonstração local. Nenhuma cobrança PIX real foi emitida.`);
    }
    setShowCreate(false);
    setActive('Operações');
  }

  async function addWallet() {
    if (!wallet.trim()) { setNotice('Informe o endereço da carteira.'); return; }
    if (!walletHolder.trim()) { setNotice('Informe o nome do titular da carteira.'); return; }
    const token = localStorage.getItem('pixsplit_token');
    if (token) {
      try {
        const networkCode = network.startsWith('TRON') ? 'tron' : 'polygon';
        await apiRequest('/v1/wallets', { method: 'POST', body: JSON.stringify({
          label: `${exchange} ${network}`, exchangeName: exchange, networkCode, address: wallet,
          walletType, holderName: walletHolder, holderTaxId: walletHolderTaxId || undefined,
          holderCountry: 'BR', vaspEntityCountry: walletType === 'HOSTED' ? vaspCountry : undefined, makeDefault: wallets.length === 0,
        }) }, token);
        await refreshConnectedData(token);
        setNotice('Carteira cadastrada na sua conta. Ela permanece pendente de validação do provedor.');
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível cadastrar a carteira.'); return; }
    } else {
      setWallets([{ exchange, network, address: `${wallet.slice(0, 7)}...${wallet.slice(-5)}`, state: 'Verificação pendente (demo)', primary: wallets.length === 0 }, ...wallets]);
      setNotice('Carteira adicionada à demonstração local; ainda não está aprovada para saques.');
    }
    setShowCreate(false);
  }

  const filteredOps = operations.filter(op => `${op.id} ${op.status} ${op.wallet}`.toLowerCase().includes(search.toLowerCase()));

  async function refreshConnectedData(token: string) {
    const me = await apiRequest<{ fullName: string; role: string }>('/v1/me', {}, token);
    setCurrentUser(me.fullName);
    setCurrentRole(me.role);

    if (me.role === 'SUPER_ADMIN') {
      const adminData = await apiRequest<{ totals: ApiTotals; recentPayments: Array<{ id: string; externalId: string; status: string; amountBrlCents: string; commissionUsdt: string | null; merchantNetUsdt: string | null; merchantName: string; network: string; createdAt: string }> }>('/v1/admin/dashboard', {}, token);
      setApiTotals(adminData.totals);
      setWallets([]);
      setOperations(adminData.recentPayments.map(p => ({
        id: p.externalId, date: new Date(p.createdAt).toLocaleString('pt-BR'),
        amount: (Number(p.amountBrlCents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
        usdt: p.merchantNetUsdt ?? '—', commission: p.commissionUsdt ?? '—', status: p.status,
        wallet: `${p.merchantName} · ${p.network}`,
      })));
      setApiConnected(true);
      return;
    }

    const [apiWallets, apiPayments, dashboard] = await Promise.all([
      apiRequest<ApiWallet[]>('/v1/wallets', {}, token),
      apiRequest<Array<{ id: string; externalId: string; status: string; amountBrlCents: string; commissionUsdt: string | null; merchantNetUsdt: string | null; wallet: { label: string; exchangeName: string; networkCode: string; addressLast8: string }; createdAt: string }>>('/v1/payments', {}, token),
      apiRequest<{ totals: ApiTotals }>('/v1/dashboard', {}, token),
    ]);
    setApiTotals(dashboard.totals);
    setWallets(apiWallets.map(w => ({ id: w.id, exchange: w.exchangeName, network: w.networkCode.toUpperCase(), address: w.address, state: w.status === 'VERIFIED' ? 'Verificada' : 'Verificação pendente', primary: w.isDefault })));
    setOperations(apiPayments.map(p => ({
      id: p.externalId, date: new Date(p.createdAt).toLocaleString('pt-BR'),
      amount: (Number(p.amountBrlCents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      usdt: p.merchantNetUsdt ?? '—', commission: p.commissionUsdt ?? '—', status: p.status,
      wallet: `${p.wallet.exchangeName} · ${p.wallet.networkCode}`,
    })));
    setApiConnected(true);
  }


  useEffect(() => {
    const token = localStorage.getItem('pixsplit_token');
    if (!token) return;
    refreshConnectedData(token).catch(() => {
      localStorage.removeItem('pixsplit_token');
      setApiConnected(false);
      setNotice('Sua sessão expirou ou a API não está disponível. Entre novamente para conectar a conta.');
    });
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><span>p</span></div><div><b>pixsplit</b><small>PAYMENTS PLATFORM</small></div></div>
        <div className="workspace"><div className="workspace-icon">P</div><div><b>Minha operação</b><small>Conta de demonstração</small></div><ChevronDown size={15}/></div>
        <div className="nav-label">PLATAFORMA</div>
        <nav>{nav.map(item => { const Icon = item.icon; return <button key={item.label} className={`nav-item ${active === item.label ? 'active' : ''}`} onClick={() => setActive(item.label)}><Icon size={18}/><span>{item.label}</span>{item.label === 'Operações' && <i>4</i>}</button>; })}</nav>
        <div className="nav-label nav-spacer">CONFIGURAÇÕES</div>
        <nav>
          <button className="nav-item" onClick={() => setNotice('As configurações da conta serão conectadas na próxima etapa.')}><Settings size={18}/><span>Configurações</span></button>
          <button className="nav-item" onClick={() => setNotice('Central de ajuda em construção.')}><LifeBuoy size={18}/><span>Ajuda e suporte</span></button>
        </nav>
        <div className="sidebar-bottom"><div className="security"><ShieldCheck size={17}/><div><b>Ambiente protegido</b><small>Modo demonstração · sem dinheiro real</small></div></div><div className="user-mini"><div className="avatar">MB</div><div><b>{currentUser}</b><small>{apiConnected ? 'Conta conectada' : 'Conta de demonstração'}</small></div><button aria-label="Sair" onClick={() => { localStorage.removeItem('pixsplit_token'); setApiConnected(false); setNotice('Sessão encerrada.'); }}><LogOut size={16}/></button></div></div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div className="breadcrumb">Plataforma <span>/</span> <b>{active}</b></div><div className="top-actions"><span className="env-pill"><span/> {apiConnected ? 'CONTA CONECTADA · MOCK' : 'DEMONSTRAÇÃO'}</span>{!apiConnected && <Link href="/login" className="text-btn">Entrar</Link>}<button className="icon-btn" aria-label="Ajuda" onClick={() => setNotice('Documentação de ajuda em construção.')}><CircleHelp size={18}/></button><button className="icon-btn notification" aria-label="Notificações" onClick={() => setNotice('Você está em ambiente de demonstração.')}><Bell size={18}/><i/></button><button className="avatar avatar-small" title={apiConnected ? 'Sair' : 'Conta demo'} onClick={() => { localStorage.removeItem('pixsplit_token'); setApiConnected(false); setNotice('Sessão encerrada.'); }}>{currentUser.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</button></div></header>

        {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}

        {active === 'Visão geral' && <>
          <section className="page-heading"><div><div className="eyebrow">CENTRAL DE CONTROLE</div><h1>Visão geral</h1><p>Acompanhe seus recebimentos, conversões e comissões em um só lugar.</p></div>{currentRole !== 'SUPER_ADMIN' && <button className="primary-btn" onClick={() => setShowCreate(true)}><Plus size={17}/> Nova cobrança PIX</button>}</section>
          <section className="metric-grid">
            <Metric title="Volume processado" value={apiTotals ? (Number(apiTotals.volumeBrlCents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : "R$ 12.480,00"} delta={apiConnected ? `${apiTotals?.paymentsTotal ?? 0} operações · mock` : "Demonstração"} icon={<ArrowDownLeft size={18}/>} />
            <Metric title={currentRole === 'SUPER_ADMIN' ? "USDT enviados aos usuários" : "USDT recebidos"} value={apiTotals ? apiTotals.merchantNetUsdt : "2.246,40"} detail="USDT · valores simulados" icon={<Wallet size={18}/>} />
            <Metric title={currentRole === 'SUPER_ADMIN' ? "Receita da plataforma (2%)" : "Taxas da plataforma (2%)"} value={`${apiTotals?.commissionUsdt ?? "44.93"} USDT`} delta="Regra configurada" icon={<ArrowDownRight size={18}/>} accent />
            <Metric title="Operações concluídas" value={String(apiTotals?.completed ?? 2)} detail={`de ${apiTotals?.paymentsTotal ?? 4} operações`} icon={<BadgeCheck size={18}/>} />
          </section>
          <section className="content-grid">
            <div className="panel operations-panel"><div className="panel-header"><div><h2>Operações recentes</h2><p>Últimos pagamentos criados na plataforma</p></div><button className="text-btn" onClick={() => setActive('Operações')}>Ver todas <ArrowUpRight size={15}/></button></div><div className="table-wrap"><table><thead><tr><th>OPERAÇÃO</th><th>VALOR PIX</th><th>USDT DESTINO</th><th>{currentRole === 'SUPER_ADMIN' ? "COMISSÃO DA PLATAFORMA" : "TAXA 2%"}</th><th>STATUS</th></tr></thead><tbody>{operations.slice(0, 4).map(op => <tr key={op.id}><td><b>{op.id}</b><small>{op.date}</small></td><td>{op.amount}</td><td><b>{op.usdt}</b><small>{op.wallet}</small></td><td className="green">{op.commission} USDT</td><td><Status value={op.status}/></td></tr>)}</tbody></table></div></div>
            <div className="panel commission-panel"><div className="panel-header"><div><h2>{currentRole === 'SUPER_ADMIN' ? "Comissão da plataforma" : "Taxas da plataforma"}</h2><p>{currentRole === 'SUPER_ADMIN' ? "Receita por operação concluída" : "Taxa cobrada nas operações concluídas"}</p></div><div className="commission-icon"><ArrowDownRight size={18}/></div></div><div className="commission-total">{apiTotals?.commissionUsdt ?? "44,93"} <span>USDT</span></div><div className="commission-sub">Comissão configurada em <b>2,00%</b></div><div className="progress"><span style={{ width: '64%' }}/></div><div className="commission-foot"><span>{currentRole === 'SUPER_ADMIN' ? "Comissões simuladas" : "Taxas simuladas"}</span><b>{apiTotals?.completed ?? 2} operações</b></div>{currentRole === 'SUPER_ADMIN' && <div className="wallet-destination"><div className="wallet-icon"><Wallet size={16}/></div><div><small>CARTEIRA DE COMISSÃO</small><b>Carteira da plataforma</b></div><span className="tag-pending">A configurar</span></div>}</div>
          </section>
          <section className="bottom-grid"><div className="panel"><div className="panel-header"><div><h2>{currentRole === 'SUPER_ADMIN' ? "Visão de comerciantes" : "Carteiras de recebimento"}</h2><p>{currentRole === 'SUPER_ADMIN' ? "Base de usuários e recebedores cadastrados" : "Endereços vinculados à sua conta"}</p></div>{currentRole !== 'SUPER_ADMIN' && <button className="text-btn" onClick={() => setActive('Carteiras')}>Gerenciar <ArrowUpRight size={15}/></button>}</div><div className="wallet-list">{currentRole === 'SUPER_ADMIN' ? <div className="wallet-row"><div className="exchange-logo">U</div><div className="wallet-info"><b>{apiTotals?.merchants ?? 0} usuários cadastrados</b><small>{apiTotals?.pendingKyc ?? 0} cadastros aguardando KYC/validação</small></div><Status value="Aguardando compliance"/></div> : wallets.map((w, i) => <div className="wallet-row" key={`${w.exchange}-${i}`}><div className="exchange-logo">{w.exchange.slice(0,1)}</div><div className="wallet-info"><b>{w.exchange} <span>{w.primary ? 'Principal' : ''}</span></b><small>{w.network} · {w.address}</small></div><Status value={w.state}/></div>)}</div></div><div className="panel next-panel"><div className="panel-header"><div><h2>Próximos passos</h2><p>Preparação para homologação</p></div><div className="step-count">02/05</div></div><div className="check-list"><Check done label="Modelo de negócio e comissão definidos"/><Check done label="Estrutura inicial do sistema criada"/><Check current label="Cadastro de parceiro e sandbox Foxbit"/><Check label="Testar PIX de terceiros e liquidação USDT"/><Check label="Homologar split 98% / 2%"/></div></div></section>
        </>}

        {active === 'Operações' && <><section className="page-heading"><div><div className="eyebrow">FINANCEIRO</div><h1>Operações</h1><p>Consulte cobranças, conversões, comissões e liquidações.</p></div>{currentRole !== 'SUPER_ADMIN' && <button className="primary-btn" onClick={() => setShowCreate(true)}><Plus size={17}/> Nova cobrança PIX</button>}</section><div className="panel full-panel"><div className="panel-header"><div><h2>Todas as operações</h2><p>Registros de demonstração — sem liquidação real</p></div><div className="search-box"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar operação"/></div></div><div className="table-wrap"><table><thead><tr><th>OPERAÇÃO</th><th>PIX (BRL)</th><th>CONVERSÃO (USDT)</th><th>COMISSÃO 2%</th><th>DESTINO</th><th>STATUS</th></tr></thead><tbody>{filteredOps.map(op => <tr key={op.id}><td><b>{op.id}</b><small>{op.date}</small></td><td>{op.amount}</td><td>{op.usdt}</td><td className="green">{op.commission}</td><td>{op.wallet}</td><td><Status value={op.status}/></td></tr>)}</tbody></table>{filteredOps.length === 0 && <div className="empty-state">Nenhuma operação encontrada.</div>}</div></div></>}

        {active === 'Carteiras' && <><section className="page-heading"><div><div className="eyebrow">DESTINOS DE RECEBIMENTO</div><h1>Carteiras</h1><p>Endereços cadastrados pelos usuários para receber USDT.</p></div>{currentRole !== 'SUPER_ADMIN' && <button className="primary-btn" onClick={() => { setShowCreate(true); setNotice(''); }}><Plus size={17}/> Adicionar carteira</button>}</section><div className="panel full-panel"><div className="panel-header"><div><h2>Carteiras cadastradas</h2><p>A rede precisa ser exatamente igual à rede da corretora.</p></div><span className="env-pill">{wallets.length} CADASTROS</span></div><div className="wallet-list large">{currentRole === 'SUPER_ADMIN' ? <div className="empty-state">A gestão global de carteiras será liberada no console administrativo.</div> : wallets.map((w, i) => <div className="wallet-row" key={`${w.exchange}-${i}`}><div className="exchange-logo">{w.exchange.slice(0,1)}</div><div className="wallet-info"><b>{w.exchange} {w.primary && <span className="primary-label">PADRÃO</span>}</b><small>{w.network} · {w.address}</small></div><Status value={w.state}/><button className="icon-btn" onClick={() => setNotice('A validação de carteira será executada pelo provedor após a integração.')}><ExternalLink size={16}/></button></div>)}</div></div><div className="info-banner"><ShieldCheck size={20}/><div><b>Segurança de carteiras</b><p>O sistema não solicita senha, API key de saque, seed phrase ou chave privada da corretora. Serão coletados apenas endereço público, rede e dados obrigatórios de titularidade/Travel Rule.</p></div></div></>}

        {active === 'Integração API' && <><section className="page-heading"><div><div className="eyebrow">DESENVOLVEDORES</div><h1>Integração API</h1><p>Conecte seu sistema à PixSplit para criar cobranças automaticamente.</p></div><span className="env-pill">EM DESENVOLVIMENTO</span></section><div className="content-grid"><div className="panel"><h2>API de cobranças</h2><p className="panel-desc">A API pública será disponibilizada após autenticação, KYC e homologação do provedor financeiro.</p><div className="code-sample"><div className="code-head">POST /v1/payments <button onClick={() => { navigator.clipboard?.writeText('POST /v1/payments'); setNotice('Endpoint copiado.'); }}><Copy size={14}/> Copiar</button></div><pre>{`{
  "amountBrlCents": 100000,
  "walletId": "wallet_id",
  "description": "Pedido #123"
}`}</pre></div><div className="feature-line"><LockKeyhole size={17}/><span>Chaves de API por usuário, escopos e idempotência serão liberados na etapa de integração.</span></div></div><div className="panel"><h2>Status do provedor</h2><div className="provider-status"><div className="provider-mark">F</div><div><b>Foxbit Infra</b><small>Integração institucional</small></div><Status value="Aguardando credenciais"/></div><div className="status-list"><div><span>API keys</span><b>Pendentes</b></div><div><span>Sandbox</span><b>Pendente de habilitação</b></div><div><span>PIX de terceiros</span><b>Confirmação necessária</b></div><div><span>Liquidação de comissão</span><b>Em homologação</b></div></div><a className="docs-link" href="https://docs.foxbit.com.br/rest/v3/partners/" target="_blank" rel="noreferrer">Documentação de parceiros Foxbit <ExternalLink size={14}/></a></div></div></>}

        {active === 'Relatórios' && <><section className="page-heading"><div><div className="eyebrow">ANÁLISE FINANCEIRA</div><h1>Relatórios</h1><p>Acompanhe volume, valores convertidos e comissões.</p></div><span className="env-pill">DADOS SIMULADOS</span></section><div className="metric-grid"><Metric title="Volume demonstrativo" value="R$ 4.970,00" detail="Operações de exemplo" icon={<CreditCard size={18}/>} /><Metric title="USDT de exemplo" value="894,60" detail="USDT simulado" icon={<Wallet size={18}/>} /><Metric title="Comissão projetada" value="17,89 USDT" detail="2% das operações" icon={<ArrowDownRight size={18}/>} accent /><Metric title="Taxa de conclusão" value="50%" detail="Amostra demonstrativa" icon={<Activity size={18}/>} /></div><div className="info-banner"><BookOpen size={20}/><div><b>Relatórios de produção</b><p>Os números reais só serão exibidos após integração, conciliação de extratos do provedor e confirmação dos hashes de cada transferência.</p></div></div></>}
        <footer className="footer"><span>PixSplit © 2026</span><span>Pagamentos e liquidação USDT</span><span>Ambiente de desenvolvimento</span></footer>
      </main>

      {showCreate && currentRole !== 'SUPER_ADMIN' && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowCreate(false); }}><div className="modal"><div className="modal-header"><div><div className="eyebrow">NOVA CONFIGURAÇÃO</div><h2>{active === 'Carteiras' ? 'Adicionar carteira' : 'Criar cobrança PIX'}</h2><p>{active === 'Carteiras' ? 'Vincule o endereço de depósito da corretora.' : 'Gere uma cobrança demonstrativa para testar a experiência.'}</p></div><button className="icon-btn" onClick={() => setShowCreate(false)}>×</button></div>
        {active !== 'Carteiras' && <><label>Valor da cobrança (BRL)<input className="field" type="number" min="5" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}/></label><div className="estimate"><div><small>Conversão indicativa (simulada)</small><b>{indicativeUsdt} USDT</b></div><div><small>Sua comissão (2%)</small><b className="green">{commission} USDT</b></div><div><small>Valor líquido ao usuário</small><b>{net} USDT</b></div></div></>}
        <div className="form-row"><label>Corretora / VASP<select className="field" value={exchange} onChange={e => setExchange(e.target.value)}><option>Binance</option><option>OKX</option><option>Bybit</option><option>Foxbit</option><option>Outra corretora</option></select></label><label>Rede USDT<select className="field" value={network} onChange={e => setNetwork(e.target.value)}><option>TRON (TRC-20)</option><option>Polygon</option></select></label></div>
        <label>Endereço de recebimento<input className="field" value={wallet} onChange={e => setWallet(e.target.value)} placeholder={network.includes('TRON') ? 'Endereço iniciando com T...' : 'Endereço 0x... da carteira'}/></label><div className="form-row"><label>Titular da carteira<input className="field" value={walletHolder} onChange={e => setWalletHolder(e.target.value)} placeholder="Nome completo ou razão social"/></label><label>CPF/CNPJ do titular (igual ao cadastro)<input className="field" required={walletType === 'HOSTED'} value={walletHolderTaxId} onChange={e => setWalletHolderTaxId(e.target.value.replace(/\D/g,''))} placeholder="Somente números"/></label></div><div className="form-row"><label>Tipo de carteira<select className="field" value={walletType} onChange={e=>setWalletType(e.target.value)}><option value="HOSTED">Corretora / VASP (HOSTED)</option><option value="SELF_HOSTED">Carteira própria (SELF_HOSTED)</option></select></label>{walletType === 'HOSTED' && <label>País da entidade legal da corretora (ISO-2)<input className="field" required value={vaspCountry} maxLength={2} onChange={e=>setVaspCountry(e.target.value.toUpperCase())} placeholder="Confirmar com a corretora"/></label>}</div>
        <div className="modal-warning"><ShieldCheck size={17}/><span>Não informe senhas, chaves privadas, seed phrases ou códigos de autenticação da corretora.</span></div>
        <div className="modal-actions"><button className="secondary-btn" onClick={() => setShowCreate(false)}>Cancelar</button><button className="primary-btn" onClick={active === 'Carteiras' ? addWallet : createMockOperation}>{active === 'Carteiras' ? 'Cadastrar carteira (demo)' : 'Criar cobrança simulada'}</button></div>
        <small className="modal-disclaimer">Modo demonstração: não gera PIX válido, não compra USDT e não envia criptoativos.</small></div></div>}
    </div>
  );
}

function Metric({ title, value, detail, delta, icon, accent = false }: { title: string; value: string; detail?: string; delta?: string; icon: ReactNode; accent?: boolean }) {
  return <article className={`metric-card ${accent ? 'metric-accent' : ''}`}><div className="metric-top"><span>{title}</span><div className="metric-icon">{icon}</div></div><div className="metric-value">{value}</div><div className="metric-bottom">{delta ? <span className="green">{delta}</span> : <span>{detail}</span>}</div></article>;
}
function Status({ value }: { value: string }) {
  const lower = value.toLowerCase();
  const cls = lower.includes('conclu') || lower.includes('verificada') ? 'success' : lower.includes('aguardando') || lower.includes('pendente') || lower.includes('análise') ? 'warning' : 'neutral';
  return <span className={`status ${cls}`}><i/>{value}</span>;
}
function Check({ label, done = false, current = false }: { label: string; done?: boolean; current?: boolean }) {
  return <div className={`check-item ${done ? 'done' : ''} ${current ? 'current' : ''}`}><span>{done ? <BadgeCheck size={15}/> : current ? <Clock3 size={15}/> : <span className="check-empty"/>}</span>{label}</div>;
}
