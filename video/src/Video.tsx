import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing } from "remotion";
import { C, FONT, MONO } from "./theme";

export const FPS = 30;
const S = (sec: number) => Math.round(sec * FPS);
export const DURATION = S(50);

// ---------- helpers ----------
const Fade: React.FC<{ children: React.ReactNode; delay?: number; y?: number; style?: React.CSSProperties }> = ({ children, delay = 0, y = 24, style }) => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200, stiffness: 120 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * y}px)`, ...style }}>{children}</div>;
};
const Scene: React.FC<{ children: React.ReactNode; from: number; dur: number }> = ({ children, from, dur }) => (
  <Sequence from={from} durationInFrames={dur}><SceneFade dur={dur}>{children}</SceneFade></Sequence>
);
const SceneFade: React.FC<{ children: React.ReactNode; dur: number }> = ({ children, dur }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 10, dur - 10, dur], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o, background: C.bg, color: C.ink, fontFamily: FONT, padding: 120 }}>{children}</AbsoluteFill>;
};
const H1: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 84 }) => <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.5 }}>{children}</div>;
const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ fontSize: 34, color: C.mute, marginTop: 24, lineHeight: 1.4 }}>{children}</div>;
const Tag: React.FC<{ children: React.ReactNode; color?: string; bg?: string }> = ({ children, color = C.acc, bg = C.accSoft }) => <span style={{ fontSize: 26, padding: "6px 16px", borderRadius: 99, background: bg, color, fontWeight: 600 }}>{children}</span>;
const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => <div style={{ background: C.card, border: `2px solid ${C.line}`, borderRadius: 24, padding: "28px 36px", ...style }}>{children}</div>;
const Logo = () => <div style={{ position: "absolute", top: 60, left: 120, fontSize: 30, fontWeight: 800, color: C.ink, opacity: 0.85 }}>AgentBazaar <span style={{ color: C.mute, fontWeight: 400 }}>· Avalanche Fuji</span></div>;

// ---------- scenes ----------
const Title = () => {
  const frame = useCurrentFrame(); const { fps } = useVideoConfig();
  const glow = interpolate(frame, [0, 40], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center" }}>
      <div style={{ position: "absolute", left: 1150, top: 200, width: 700, height: 700, borderRadius: "50%", background: `radial-gradient(circle, ${C.accSoft} 0%, transparent 70%)`, opacity: glow }} />
      <Fade><Tag>AI Agent track · Team1 Codebase Hackathon</Tag></Fade>
      <Fade delay={8}><div style={{ height: 36 }} /><H1 size={128}>AgentBazaar</H1></Fade>
      <Fade delay={18}><Sub>Give an AI agent a budget.<br />Watch it hire, pay, and rate other agents, on Avalanche.</Sub></Fade>
    </AbsoluteFill>
  );
};

const Problem = () => (
  <AbsoluteFill style={{ justifyContent: "center" }}>
    <Logo />
    <Fade><H1>Agents cannot buy things.</H1></Fade>
    <div style={{ display: "flex", gap: 32, marginTop: 64 }}>
      {[
        ["No accounts", "An agent cannot sign up, pass KYC, or manage API keys mid task."],
        ["No micropayments", "Card rails cannot charge 0.002 AVAX per call."],
        ["No shared trust", "Nowhere neutral to find an agent, see its price, or check its track record."],
      ].map(([t, d], i) => (
        <Fade key={t} delay={12 + i * 10} style={{ flex: 1 }}>
          <Card style={{ height: 300 }}>
            <div style={{ fontSize: 40, fontWeight: 700, color: C.acc }}>{t}</div>
            <div style={{ fontSize: 30, color: C.mute, marginTop: 16, lineHeight: 1.4 }}>{d}</div>
          </Card>
        </Fade>
      ))}
    </div>
  </AbsoluteFill>
);

const STEPS = [
  ["Plan", "Split the question into subtasks. Refuse harmful requests."],
  ["Discover", "Read agents, prices, ratings from AgentRegistry."],
  ["Select", "Best rating per AVAX. Skip agents with a bad record."],
  ["Pay", "payAgent(id) on chain. Budget cap enforced in code."],
  ["Call", "Agent verifies the payment event, rejects reuse."],
  ["Judge", "LLM judge scores 1 to 5 against a rubric."],
  ["Rate", "rateJob(paymentRef). Only the payer, only once."],
  ["Report", "Attributed findings, receipts, PDF download."],
];
const HowItWorks = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ justifyContent: "center" }}>
      <Logo />
      <Fade><H1>One loop, every step on chain</H1></Fade>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 28, marginTop: 56 }}>
        {STEPS.map(([t, d], i) => {
          const on = frame > 14 + i * 14;
          return (
            <Fade key={t} delay={14 + i * 14}>
              <Card style={{ height: 250, borderColor: on ? C.acc : C.line }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.accSoft, color: C.acc, display: "grid", placeItems: "center", fontSize: 28, fontWeight: 800 }}>{i + 1}</div>
                  <div style={{ fontSize: 40, fontWeight: 700 }}>{t}</div>
                </div>
                <div style={{ fontSize: 26, color: C.mute, marginTop: 18, lineHeight: 1.4 }}>{d}</div>
              </Card>
            </Fade>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const FEED = [
  ["ok", "Budget Analyst selected at 0.0005 AVAX · no ratings yet"],
  ["ok", "Paid Budget Analyst 0.0005 AVAX · tx 0x2277c9… on Snowtrace"],
  ["bad", "Rated Budget Analyst 2/5 on chain · vague, no facts, no sources"],
  ["warn", "Retrying with next best agent"],
  ["ok", "Paid News Analyst 0.002 AVAX · rated 5/5"],
  ["ok", "Paid On-chain Analyst 0.005 AVAX · rated 5/5"],
  ["ok", "Report ready · spent 0.0075 of 0.05 AVAX"],
];
const Reputation = () => {
  const frame = useCurrentFrame();
  const spent = FEED.slice(0, Math.max(0, Math.floor((frame - 10) / 22))).reduce((t, [, l]) => t + (/Paid .* ([0-9.]+) AVAX/.exec(l) ? +/Paid .* ([0-9.]+) AVAX/.exec(l)![1] : 0), 0);
  return (
    <AbsoluteFill style={{ justifyContent: "center" }}>
      <Logo />
      <Fade><H1>The reputation moment</H1></Fade>
      <div style={{ display: "flex", gap: 40, marginTop: 44, alignItems: "flex-start" }}>
        <Card style={{ flex: 1.4, minHeight: 560 }}>
          {FEED.map(([k, l], i) => {
            const d = 10 + i * 22; if (frame < d) return null;
            const col = k === "bad" ? C.bad : k === "warn" ? C.warn : C.acc;
            const bg = k === "bad" ? C.badSoft : k === "warn" ? C.warnSoft : C.accSoft;
            return (
              <Fade key={i} delay={d} y={12}>
                <div style={{ display: "flex", gap: 18, padding: "16px 0", borderBottom: `1px solid ${C.line}`, fontSize: 28, alignItems: "center" }}>
                  <div style={{ width: 34, height: 34, borderRadius: "50%", background: bg, color: col, display: "grid", placeItems: "center", fontSize: 22, fontWeight: 800, flex: "none" }}>{k === "bad" ? "×" : k === "warn" ? "!" : "✓"}</div>
                  <div>{l}</div>
                </div>
              </Fade>
            );
          })}
        </Card>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24 }}>
          <Card><div style={{ fontSize: 26, color: C.mute }}>Budget · hard cap in code</div><div style={{ fontSize: 64, fontWeight: 800, color: C.acc, fontFamily: MONO }}>{spent.toFixed(4)} <span style={{ fontSize: 30, color: C.mute }}>/ 0.05 AVAX</span></div></Card>
          <Fade delay={FEED.length * 22 + 10}>
            <Card style={{ borderColor: C.warn }}>
              <div style={{ fontSize: 26, color: C.warn, fontWeight: 700 }}>Next question</div>
              <div style={{ fontSize: 30, marginTop: 10, lineHeight: 1.4 }}>News Analyst chosen. <b>Skipped Budget Analyst (rating 2.00) despite lower price.</b></div>
            </Card>
          </Fade>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Trust = () => (
  <AbsoluteFill style={{ justifyContent: "center" }}>
    <Logo />
    <Fade><H1>Trust is enforced by code, not prompts</H1></Fade>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginTop: 56 }}>
      {[
        ["Payer-bound ratings", "rateJob accepts only the wallet that paid, once per payment. Fabricated references revert."],
        ["Budget guard before every payment", "The LLM plans, but Session.canPay() decides. Max 10 paid calls per session."],
        ["Paid means spent", "A settled payment is receipted even if the agent then fails. The agent is rated 1 for it."],
        ["Open marketplace", "Anyone lists an agent from their own wallet. Bad agents are punished by ratings, not gatekeeping."],
      ].map(([t, d], i) => (
        <Fade key={t} delay={12 + i * 10}>
          <Card style={{ height: 220 }}>
            <div style={{ fontSize: 38, fontWeight: 700, color: C.acc }}>{t}</div>
            <div style={{ fontSize: 28, color: C.mute, marginTop: 14, lineHeight: 1.4 }}>{d}</div>
          </Card>
        </Fade>
      ))}
    </div>
    <Fade delay={60}><div style={{ marginTop: 40, fontSize: 26, color: C.mute }}>Verified contract · <span style={{ fontFamily: MONO, color: C.ink }}>0x22D59425EEEF168f776fecc280887DCA072730f9</span> · 22 automated tests</div></Fade>
  </AbsoluteFill>
);

const Outro = () => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
    <Fade><H1 size={110}>No accounts. No API keys.<br />No middleman.</H1></Fade>
    <Fade delay={16}><Sub>An open agent economy with public reputation, built on Avalanche.</Sub></Fade>
    <Fade delay={30}><div style={{ marginTop: 60, display: "flex", gap: 24 }}><Tag>github.com/snavohburmaa/agent-bazaar</Tag><Tag color={C.warn} bg={C.warnSoft}>Avalanche Fuji · AI Agent track</Tag></div></Fade>
  </AbsoluteFill>
);

export const Video = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Scene from={S(0)} dur={S(6)}><Title /></Scene>
    <Scene from={S(6)} dur={S(8)}><Problem /></Scene>
    <Scene from={S(14)} dur={S(11)}><HowItWorks /></Scene>
    <Scene from={S(25)} dur={S(12)}><Reputation /></Scene>
    <Scene from={S(37)} dur={S(8)}><Trust /></Scene>
    <Scene from={S(45)} dur={S(5)}><Outro /></Scene>
  </AbsoluteFill>
);
