# Let's verify the exact SVG and helper code
hero_code = '''
/* ─────────────────────────────────────────────────────────────
   Spacious Hero Medical SVG Illustration Showcase (Light Theme)
   ───────────────────────────────────────────────────────────── */
function HeroMedicalIllustrationShowcase() {
    return (
        <div className="group/hero relative w-full rounded-2xl bg-gradient-to-br from-[#f8f2ff] via-[#f3e8ff]/80 to-[#fae8ff]/65 border border-purple-200/70 px-4 py-3 sm:px-6 sm:py-3.5 overflow-hidden shadow-inner transition-all duration-500 hover:border-purple-300 hover:shadow-lg hover:shadow-purple-500/10 select-none">
            <style>{`
                @keyframes panaceaFloatVial {
                    0%, 100% { transform: translateY(0px) rotate(6deg); }
                    50% { transform: translateY(-6px) rotate(8deg); }
                }
                @keyframes panaceaFloatPillLeft {
                    0%, 100% { transform: translateY(0px) rotate(-26deg); }
                    50% { transform: translateY(-5px) rotate(-22deg); }
                }
                @keyframes panaceaFloatPillRight {
                    0%, 100% { transform: translateY(0px) rotate(28deg); }
                    50% { transform: translateY(5px) rotate(33deg); }
                }
                @keyframes panaceaOrbitSlow {
                    0% { stroke-dashoffset: 0; }
                    100% { stroke-dashoffset: -48; }
                }
                @keyframes panaceaNodePulse {
                    0%, 100% { opacity: 0.45; transform: scale(1); }
                    50% { opacity: 0.85; transform: scale(1.15); }
                }
                @media (prefers-reduced-motion: no-preference) {
                    .panacea-vial-float { animation: panaceaFloatVial 5.5s ease-in-out infinite; }
                    .panacea-pill-l { animation: panaceaFloatPillLeft 6.2s ease-in-out infinite; }
                    .panacea-pill-r { animation: panaceaFloatPillRight 5.8s ease-in-out infinite; }
                    .panacea-orbit-dash { animation: panaceaOrbitSlow 18s linear infinite; }
                    .panacea-node-pulse { animation: panaceaNodePulse 4s ease-in-out infinite; }
                }
            `}</style>

            {/* Delicate scientific SVG grid pattern at ~7% opacity */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <pattern id="panaceaHeroSciGrid" width="36" height="36" patternUnits="userSpaceOnUse">
                        <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#6b21a8" strokeWidth="0.8" />
                        <circle cx="18" cy="18" r="1.2" fill="#7c3aed" />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#panaceaHeroSciGrid)" />
            </svg>

            {/* Soft Lavender Radial Glows */}
            <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-96 h-44 bg-purple-400/20 rounded-full blur-3xl pointer-events-none transition-opacity duration-500 group-hover/hero:opacity-95" />
            <div className="absolute -bottom-16 right-12 w-64 h-36 bg-fuchsia-300/20 rounded-full blur-2xl pointer-events-none" />

            {/* Top Caption Strip inside Illustration Zone */}
            <div className="relative z-10 flex items-center justify-between text-[10px] font-extrabold tracking-widest uppercase text-purple-600/80 mb-1">
                <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                    <span>Clinical Telemetry</span>
                </span>
                <span className="tracking-[0.2em] text-purple-700/85">PANACEA SMART STOCK ENGINE • LIVE</span>
                <span className="inline-flex items-center gap-1 text-purple-500">
                    <Pill className="w-3.5 h-3.5" />
                </span>
            </div>

            {/* Central Custom Medical Vector Artwork */}
            <div className="relative z-10 w-full h-32 sm:h-40 flex items-center justify-center">
                <svg viewBox="0 0 700 180" className="w-full h-full max-w-[680px] overflow-visible">
                    <defs>
                        <linearGradient id="heroVialBody" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#d8b4fe" stopOpacity="0.95" />
                            <stop offset="50%" stopColor="#c084fc" stopOpacity="0.9" />
                            <stop offset="100%" stopColor="#9333ea" stopOpacity="0.95" />
                        </linearGradient>
                        <linearGradient id="heroVialCap" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#7e22ce" />
                            <stop offset="100%" stopColor="#9333ea" />
                        </linearGradient>
                        <linearGradient id="heroCapsuleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#ffffff" />
                            <stop offset="48%" stopColor="#f3e8ff" />
                            <stop offset="52%" stopColor="#d8b4fe" />
                            <stop offset="100%" stopColor="#c084fc" />
                        </linearGradient>
                        <filter id="softPurpleGlow" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#9333ea" floodOpacity="0.22" />
                        </filter>
                    </defs>

                    {/* Molecular Constellation Nodes */}
                    <g stroke="#c084fc" strokeWidth="1.2" opacity="0.45" fill="none">
                        <polyline points="55,55 95,38 130,65 98,95 55,55" />
                        <line x1="130" y1="65" x2="168" y2="50" />
                        <polyline points="545,135 585,110 625,138 595,165 545,135" />
                        <line x1="585" y1="110" x2="610" y2="75" />
                    </g>
                    <g className="panacea-node-pulse" fill="#a855f7">
                        <circle cx="55" cy="55" r="3.5" />
                        <circle cx="95" cy="38" r="2.8" />
                        <circle cx="130" cy="65" r="4" />
                        <circle cx="98" cy="95" r="2.5" />
                        <circle cx="168" cy="50" r="3" />
                        <circle cx="545" cy="135" r="3" />
                        <circle cx="585" cy="110" r="4" />
                        <circle cx="625" cy="138" r="3" />
                        <circle cx="610" cy="75" r="2.5" />
                    </g>

                    {/* Intersecting Orbital Rings */}
                    <g transform="translate(350, 92)">
                        <ellipse
                            rx="215"
                            ry="48"
                            transform="rotate(-11)"
                            fill="none"
                            stroke="#c084fc"
                            strokeWidth="2"
                            strokeDasharray="7 9"
                            className="panacea-orbit-dash"
                            opacity="0.75"
                        />
                        <ellipse
                            rx="155"
                            ry="62"
                            transform="rotate(24)"
                            fill="none"
                            stroke="#d8b4fe"
                            strokeWidth="1.8"
                            opacity="0.7"
                        />
                    </g>

                    {/* Medical Cross Symbols */}
                    <g stroke="#c084fc" strokeWidth="3" strokeLinecap="round" opacity="0.65">
                        <line x1="136" y1="130" x2="162" y2="130" />
                        <line x1="149" y1="117" x2="149" y2="143" />
                        <line x1="546" y1="48" x2="572" y2="48" />
                        <line x1="559" y1="35" x2="559" y2="61" />
                    </g>

                    {/* Floating Orbital Spheres */}
                    <circle cx="152" cy="65" r="7" fill="#d8b4fe" opacity="0.85" />
                    <circle cx="525" cy="128" r="7" fill="#d8b4fe" opacity="0.85" />
                    <circle cx="265" cy="32" r="4" fill="#a855f7" opacity="0.45" />
                    <circle cx="445" cy="155" r="4.5" fill="#e879f9" opacity="0.55" />

                    {/* Left Floating Capsule */}
                    <g className="panacea-pill-l" style={{ transformOrigin: "200px 75px" }}>
                        <g transform="translate(158, 55) rotate(-25)" filter="url(#softPurpleGlow)">
                            <rect x="0" y="0" width="80" height="34" rx="17" fill="url(#heroCapsuleGrad)" stroke="#a855f7" strokeWidth="2" />
                            <line x1="40" y1="0" x2="40" y2="34" stroke="#a855f7" strokeWidth="1.8" />
                            <path d="M 13 8 H 32" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />
                        </g>
                    </g>

                    {/* Right Floating Capsule */}
                    <g className="panacea-pill-r" style={{ transformOrigin: "485px 105px" }}>
                        <g transform="translate(456, 82) rotate(30)" filter="url(#softPurpleGlow)">
                            <rect x="0" y="0" width="56" height="25" rx="12.5" fill="url(#heroCapsuleGrad)" stroke="#a855f7" strokeWidth="1.8" />
                            <line x1="28" y1="0" x2="28" y2="25" stroke="#a855f7" strokeWidth="1.6" />
                        </g>
                    </g>

                    {/* Center Vaccine / Medicine Vial */}
                    <g className="panacea-vial-float" style={{ transformOrigin: "350px 90px" }}>
                        <g transform="translate(308, 18) rotate(7)" filter="url(#softPurpleGlow)">
                            <rect x="24" y="0" width="42" height="14" rx="5" fill="url(#heroVialCap)" />
                            <rect x="13" y="13" width="64" height="17" rx="6" fill="#d8b4fe" stroke="#9333ea" strokeWidth="2" />
                            <rect x="6" y="28" width="78" height="98" rx="15" fill="url(#heroVialBody)" stroke="#9333ea" strokeWidth="2.2" />
                            <rect x="15" y="42" width="60" height="54" rx="8" fill="#faf5ff" />
                            <g stroke="#7e22ce" strokeWidth="4.5" strokeLinecap="round">
                                <line x1="45" y1="58" x2="45" y2="80" />
                                <line x1="34" y1="69" x2="56" y2="69" />
                            </g>
                            <rect x="18" y="104" width="54" height="10" rx="5" fill="#faf5ff" opacity="0.9" />
                            <path d="M 13 38 V 110" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
                        </g>
                    </g>
                </svg>
            </div>

            <p className="relative z-10 text-center text-[11px] font-semibold text-purple-600/80 mt-1">
                Real-time stock telemetry • Automated low-stock & cold-chain expiry intelligence
            </p>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   Card Medical SVG Watermark Backgrounds (Category Tailored)
   ───────────────────────────────────────────────────────────── */
function CardMedicalSvgWatermark({ category, itemId }: { category: string; itemId?: string }) {
    return (
        <div className="pointer-events-none select-none absolute -right-3 -bottom-3 sm:-right-4 sm:-bottom-4 w-36 h-36 sm:w-44 sm:h-44 opacity-[0.06] group-hover:opacity-[0.14] group-hover:scale-110 group-hover:-rotate-3 group-hover:-translate-x-1 group-hover:-translate-y-1 transition-all duration-300 ease-out z-0 overflow-hidden">
            {category === "vaccinations" ? (
                /* Vaccine Vial + Needle Syringe + Cold-Chain Snowflake Contour */
                <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="#7c3aed" strokeWidth="2">
                    <circle cx="65" cy="65" r="44" strokeDasharray="5 5" opacity="0.5" />
                    <rect x="42" y="26" width="34" height="10" rx="3" />
                    <rect x="36" y="36" width="46" height="60" rx="10" />
                    <path d="M 46 64 H 72 M 59 51 V 77" strokeWidth="3" strokeLinecap="round" />
                    <line x1="20" y1="20" x2="36" y2="36" strokeLinecap="round" strokeWidth="2.5" />
                    <line x1="16" y1="24" x2="24" y2="16" strokeLinecap="round" strokeWidth="2" />
                    <circle cx="26" cy="85" r="4" fill="#a855f7" opacity="0.7" />
                    <circle cx="95" cy="40" r="3.5" fill="#c084fc" opacity="0.7" />
                </svg>
            ) : category === "blood_tests" ? (
                /* Laboratory Test-Tubes + Benzene Molecular Ring + DNA Helix */
                <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="#7c3aed" strokeWidth="2">
                    <polygon points="60,16 92,34 92,74 60,92 28,74 28,34" opacity="0.45" strokeDasharray="4 4" />
                    <rect x="46" y="22" width="24" height="70" rx="12" transform="rotate(16 60 58)" />
                    <line x1="40" y1="52" x2="72" y2="62" strokeLinecap="round" />
                    <line x1="42" y1="62" x2="74" y2="72" strokeLinecap="round" />
                    <circle cx="30" cy="34" r="4" fill="#7c3aed" />
                    <circle cx="90" cy="74" r="4" fill="#7c3aed" />
                    <circle cx="60" cy="16" r="3.5" fill="#a855f7" />
                </svg>
            ) : category === "consumables" ? (
                /* Clinical Supply Pack + Scissors Contour + Shield Cross */
                <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="#7c3aed" strokeWidth="2">
                    <circle cx="60" cy="60" r="45" opacity="0.4" strokeDasharray="5 5" />
                    <rect x="32" y="32" width="56" height="56" rx="14" />
                    <path d="M 60 44 V 76 M 44 60 H 76" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="26" cy="28" r="3.5" fill="#7c3aed" opacity="0.6" />
                    <circle cx="94" cy="92" r="4" fill="#a855f7" opacity="0.6" />
                    <line x1="88" y1="28" x2="98" y2="38" strokeLinecap="round" />
                </svg>
            ) : (
                /* Medicine Capsule + Orbital Electron Ring + Molecular Dots */
                <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="#7c3aed" strokeWidth="2">
                    <ellipse cx="60" cy="60" rx="50" ry="22" transform="rotate(-28 60 60)" strokeDasharray="4 6" opacity="0.55" />
                    <g transform="translate(26, 42) rotate(-28)">
                        <rect x="0" y="0" width="68" height="32" rx="16" />
                        <line x1="34" y1="0" x2="34" y2="32" strokeWidth="2" />
                        <path d="M 12 10 H 26" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
                    </g>
                    <circle cx="86" cy="30" r="8" opacity="0.6" />
                    <line x1="80" y1="30" x2="92" y2="30" strokeWidth="1.8" />
                    <circle cx="28" cy="88" r="4" fill="#a855f7" opacity="0.7" />
                </svg>
            )}
        </div>
    );
}
'''
print('Length of components code:', len(hero_code))
