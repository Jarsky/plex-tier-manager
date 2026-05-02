import React, { useEffect, useState } from 'react';
import { fetchSiteConfig, signupUser } from '../api';

const buildFaqs = (siteTitle: string) => [
  {
    q: `What is ${siteTitle}?`,
    a: `${siteTitle} gives you access to a private Plex media server loaded with movies, TV shows, and more. Subscribe to a plan, link your Plex account, and start watching in minutes on any device.`,
  },
  {
    q: 'How do I get started?',
    a: 'Click Get Started, enter your email address, and choose a subscription plan. Once your account is confirmed you\'ll receive instructions to link your Plex account and begin watching immediately.',
  },
  {
    q: 'What devices can I watch on?',
    a: 'Plex runs on virtually every device — Smart TVs, Roku, Apple TV, Fire TV, Android, iPhone, iPad, Mac, Windows, and Chromecast. Download the free Plex app from your device\'s app store after subscribing.',
  },
  {
    q: 'Can I upgrade or downgrade my plan?',
    a: 'Yes. You can upgrade, downgrade, or cancel your subscription at any time from your account dashboard. Changes take effect at the start of your next billing period.',
  },
  {
    q: 'How many streams does each plan include?',
    a: 'Basic includes 1 simultaneous stream at SD quality. Standard includes up to 3 streams at HD. Premium unlocks up to 10 concurrent streams in 4K Ultra HD where available.',
  },
  {
    q: 'Is my personal information secure?',
    a: 'Absolutely. We use industry-standard encryption for all data in transit and at rest. We never sell or share your personal information with third parties.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept all major credit and debit cards (Visa, Mastercard, Amex) via Stripe. Payments are processed securely and your card details are never stored on our servers.',
  },
  {
    q: 'How do I cancel my subscription?',
    a: 'You can cancel at any time from your account dashboard. Your access continues until the end of the current billing period. There are no cancellation fees or penalties.',
  },
];

const Landing: React.FC = () => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [siteTitle, setSiteTitle] = useState('Elements Plex');
  const [email, setEmail] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPlan, setSignupPlan] = useState<'basic' | 'standard' | 'premium' | null>(null);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSuccess, setSignupSuccess] = useState<string | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [signupModalOpen, setSignupModalOpen] = useState(false);

  useEffect(() => {
    fetchSiteConfig()
      .then((config) => {
        setSiteTitle(config.site_title || 'Elements Plex');
      })
      .catch(() => {
        setSiteTitle('Elements Plex');
      });
  }, []);

  const faqs = buildFaqs(siteTitle);

  const runSignup = async (emailValue: string, passwordValue?: string) => {
    setSignupLoading(true);
    setSignupError(null);
    setSignupSuccess(null);
    setGeneratedPassword(null);
    try {
      const res = await signupUser(emailValue, passwordValue);
      if (!res.success) {
        throw new Error(res.message || 'Signup failed');
      }
      setSignupSuccess(res.message || 'Account created successfully.');
      if (res.generated_password) {
        setGeneratedPassword(res.generated_password);
      }
      window.setTimeout(() => {
        window.location.href = '/account';
      }, 1200);
    } catch (e) {
      setSignupError(e instanceof Error ? e.message : 'Signup failed');
    } finally {
      setSignupLoading(false);
    }
  };

  const handleHeroSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email) return;
    await runSignup(email);
  };

  const openPlanSignup = (plan: 'basic' | 'standard' | 'premium') => {
    setSignupPlan(plan);
    setSignupModalOpen(true);
    setSignupError(null);
    setSignupSuccess(null);
    setGeneratedPassword(null);
    setSignupEmail(email);
    setSignupPassword('');
  };

  const handlePlanSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!signupEmail) return;
    await runSignup(signupEmail, signupPassword || undefined);
  };

  return (
    <div className="min-h-screen bg-[#141414] text-white flex flex-col">
      {/* Hero */}
      <section
        className="relative flex flex-col items-center justify-center min-h-screen px-4 pt-40 pb-24 text-center"
        style={{
          backgroundImage: 'linear-gradient(rgba(0,0,0,0.65), rgba(0,0,0,0.75)), url(/img/moviewallpaper.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <h1 className="text-4xl md:text-5xl font-bold mb-8 text-white drop-shadow-lg">
          Unlimited movies, TV&nbsp;shows, and more
        </h1>
        <p className="text-lg md:text-xl mb-3 text-white/90">Watch anywhere. Cancel anytime.</p>
        <p className="mb-10 text-white/80">Ready to watch? Enter your email to get started.</p>
        <form
          className="flex flex-col sm:flex-row gap-2 w-full max-w-lg mx-auto"
          onSubmit={handleHeroSignup}
        >
          <input
            type="email"
            placeholder="Email address"
            className="flex-1 px-4 py-3 rounded bg-black/60 border border-white/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={signupLoading}
            className="bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold px-6 py-3 rounded transition whitespace-nowrap"
          >
            {signupLoading ? 'Creating...' : 'Get Started →'}
          </button>
        </form>
        {signupError && <div className="mt-3 text-sm text-red-300">{signupError}</div>}
        {signupSuccess && <div className="mt-3 text-sm text-green-300">{signupSuccess}</div>}
        {generatedPassword && (
          <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200">
            <div className="font-semibold mb-1">Generated password</div>
            <div className="font-mono tracking-wide">{generatedPassword}</div>
          </div>
        )}
        <button
          className="mt-16 text-[#ff6a00] text-2xl animate-bounce"
          onClick={() => document.getElementById('plans-section')?.scrollIntoView({ behavior: 'smooth' })}
          aria-label="Scroll to plans"
        >
          &#8595; See plans
        </button>
      </section>

      {/* Plans */}
      <section id="plans-section" className="py-16 px-4 bg-[#141414]">
        <h2 className="text-3xl font-bold text-center mb-2">Choose the plan that's right for you</h2>
        <p className="text-center text-white/60 mb-10">Downgrade or cancel at any time.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {/* Basic */}
          <div className="bg-[#1c1c1c] border border-white/10 rounded-xl p-8 flex flex-col items-center text-center">
            <div className="text-xl font-bold mb-2">Basic</div>
            <div className="text-4xl font-extrabold text-[#ff6a00] mb-1">$3<span className="text-base font-normal text-white/60">/month</span></div>
            <ul className="my-4 text-sm text-white/80 space-y-2 text-left w-full">
              <li>&#10003; 1 simultaneous stream</li>
              <li>&#10003; SD video quality</li>
              <li>&#10003; Movies &amp; TV shows</li>
            </ul>
            <button onClick={() => openPlanSignup('basic')} className="mt-auto w-full block bg-[#ff6a00]/20 hover:bg-[#ff6a00] border border-[#ff6a00] text-[#ff6a00] hover:text-white font-semibold py-2 rounded transition text-center">
              Select Basic
            </button>
          </div>
          {/* Standard */}
          <div className="bg-[#1c1c1c] border-2 border-[#ff6a00] rounded-xl p-8 flex flex-col items-center text-center relative shadow-lg shadow-[#ff6a00]/20">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#ff6a00] text-white text-xs font-bold px-4 py-1 rounded-full">Most Popular</div>
            <div className="text-xl font-bold mb-2 mt-2">Standard</div>
            <div className="text-4xl font-extrabold text-[#ff6a00] mb-1">$6<span className="text-base font-normal text-white/60">/month</span></div>
            <ul className="my-4 text-sm text-white/80 space-y-2 text-left w-full">
              <li>&#10003; 3 simultaneous streams</li>
              <li>&#10003; Full HD (1080p)</li>
              <li>&#10003; Movies &amp; TV shows</li>
              <li>&#10003; Download on 1 device</li>
            </ul>
            <button onClick={() => openPlanSignup('standard')} className="mt-auto w-full block bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold py-2 rounded transition text-center">
              Select Standard
            </button>
          </div>
          {/* Premium */}
          <div className="bg-[#1c1c1c] border border-white/10 rounded-xl p-8 flex flex-col items-center text-center">
            <div className="text-xl font-bold mb-2">Premium</div>
            <div className="text-4xl font-extrabold text-[#ff6a00] mb-1">$12<span className="text-base font-normal text-white/60">/month</span></div>
            <ul className="my-4 text-sm text-white/80 space-y-2 text-left w-full">
              <li>&#10003; 10 simultaneous streams</li>
              <li>&#10003; Ultra HD (4K)</li>
              <li>&#10003; Movies &amp; TV shows</li>
              <li>&#10003; Download on 5 devices</li>
              <li>&#10003; Priority support</li>
            </ul>
            <button onClick={() => openPlanSignup('premium')} className="mt-auto w-full block bg-[#ff6a00]/20 hover:bg-[#ff6a00] border border-[#ff6a00] text-[#ff6a00] hover:text-white font-semibold py-2 rounded transition text-center">
              Select Premium
            </button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq-section" className="py-16 px-4 bg-black/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          <div className="flex flex-col gap-2">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-[#232323] rounded-lg overflow-hidden">
                <button
                  className="w-full flex justify-between items-center px-6 py-4 text-left font-semibold text-white/90 hover:text-[#ff6a00] transition"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span>{faq.q}</span>
                  <span className="text-2xl ml-4 text-[#ff6a00]">{openFaq === i ? '−' : '+'}</span>
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-4 text-white/70 text-sm">{faq.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0a0a0a] border-t border-white/10 py-10 px-4 mt-auto">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 mb-6">
          <div>
            <div className="text-[#ff6a00] font-extrabold text-xl mb-1">{siteTitle}</div>
            <p className="text-white/50 text-sm">Premium streaming, powered by Plex.</p>
          </div>
          <div>
            <div className="font-semibold mb-2">Product</div>
            <ul className="text-white/50 text-sm space-y-1">
              <li><a href="#plans-section" className="hover:text-[#ff6a00] transition">Plans &amp; Pricing</a></li>
              <li><a href="#faq-section" className="hover:text-[#ff6a00] transition">FAQ</a></li>
              <li><a href="/account" className="hover:text-[#ff6a00] transition">My Account</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">Support</div>
            <ul className="text-white/50 text-sm space-y-1">
              <li><a href="mailto:support@elements.net.nz" className="hover:text-[#ff6a00] transition">Contact Us</a></li>
              <li><a href="https://www.plex.tv/media-server-downloads/" target="_blank" rel="noopener" className="hover:text-[#ff6a00] transition">Get Plex App</a></li>
              <li><a href="https://support.plex.tv/" target="_blank" rel="noopener" className="hover:text-[#ff6a00] transition">Plex Support</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">Legal</div>
            <ul className="text-white/50 text-sm space-y-1">
              <li><a href="/privacy" className="hover:text-[#ff6a00] transition">Privacy Policy</a></li>
              <li><a href="/terms" className="hover:text-[#ff6a00] transition">Terms of Service</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-5xl mx-auto border-t border-white/10 pt-4 flex flex-col md:flex-row justify-between items-center text-white/40 text-sm gap-2">
          <span>&copy; {new Date().getFullYear()} {siteTitle} &mdash; All rights reserved.</span>
          <a href="https://github.com/Jarsky/plex-tier-manager" target="_blank" rel="noopener" className="hover:text-[#ff6a00] transition">GitHub</a>
        </div>
      </footer>

      {signupModalOpen && (
        <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" onClick={() => setSignupModalOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#121212] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">Create Account{signupPlan ? ` - ${signupPlan[0].toUpperCase()}${signupPlan.slice(1)}` : ''}</h3>
              <button className="text-white/70 hover:text-white" onClick={() => setSignupModalOpen(false)}>Close</button>
            </div>
            <form className="flex flex-col gap-3" onSubmit={handlePlanSignup}>
              <input
                type="email"
                required
                placeholder="Email"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                className="px-4 py-3 rounded bg-black/60 border border-white/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
              />
              <input
                type="password"
                placeholder="Password (optional)"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                className="px-4 py-3 rounded bg-black/60 border border-white/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-[#ff6a00]"
              />
              <button type="submit" disabled={signupLoading} className="bg-[#ff6a00] hover:bg-orange-500 text-white font-semibold py-3 rounded transition disabled:opacity-60">
                {signupLoading ? 'Creating...' : 'Create Account'}
              </button>
            </form>
            {signupError && <div className="mt-3 text-sm text-red-300">{signupError}</div>}
            {signupSuccess && <div className="mt-3 text-sm text-green-300">{signupSuccess}</div>}
            {generatedPassword && (
              <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200">
                <div className="font-semibold mb-1">Generated password</div>
                <div className="font-mono tracking-wide">{generatedPassword}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Landing;

