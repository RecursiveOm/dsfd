"use client";



import { useState, useEffect, useMemo, useRef } from "react";

import { format, isValid, subMonths } from "date-fns";

import { v4 as uuidv4 } from "uuid";

import jsPDF from "jspdf";

import autoTable from "jspdf-autotable";

import { 

    Archive, PlusCircle, AlertTriangle, RefreshCw, 

    History, Loader2, CheckCircle2, Database, Settings, Sparkles, TrendingUp, BarChart3, Search, Trash2, Download, ThermometerSnowflake, CircleDollarSign, Zap, Moon, UploadCloud, AlertOctagon, Edit2, ArrowRight, ArrowLeft, Plus, X, Box, Upload,

    Syringe, ShieldCheck, Layers, LayoutGrid, List, Clock, PackageCheck, Pill, TestTube, MapPin, Building2, CalendarClock, Activity, Wallet

} from "lucide-react";



import { useToast } from "@/hooks/use-toast";

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Button } from "@/components/ui/button";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Switch } from "@/components/ui/switch";



import { useFirebase } from "@/firebase/provider";

import { collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, serverTimestamp, query, where, limit, getDocs, writeBatch, deleteField } from "firebase/firestore";

import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

import { decryptPayload } from "@/lib/encryptionHelper";

import { cn } from "@/lib/utils";



/* ─────────────────────────────────────────────────────────────

   Helper Functions & Intelligent Stock Evaluators

   ───────────────────────────────────────────────────────────── */

function safeFormatDate(date: any, formatStr: string = 'PPP p'): string {

    if (!date) return 'Unknown date';

    const d = date instanceof Date ? date : new Date(date);

    return isValid(d) ? format(d, formatStr) : 'Invalid date';

}



function safeDecrypt(val: any): string {

    if (!val || typeof val !== 'string') return val || '';

    if (val.startsWith('U2FsdGVkX1')) {

        try {

            return decryptPayload(val) || val;

        } catch (e) {

            return val;

        }

    }

    return val;

}



export type StockHealthState = 'expired' | 'expiring_soon' | 'critical' | 'low' | 'healthy';



function evaluateItemHealth(item: CloudInventoryItem): {

    state: StockHealthState;

    isExpired: boolean;

    isExpiringSoon: boolean;

    isLowStock: boolean;

    isBackorder: boolean;

    isZero: boolean;

    daysUntilExpiry: number | null;

    capacityPercentage: number;

} {

    const now = new Date();

    let isExpired = false;

    let isExpiringSoon = false;

    let daysUntilExpiry: number | null = null;



    if (item.hasExpiry !== false && item.expiryDate) {

        const expDate = new Date(item.expiryDate);

        if (isValid(expDate)) {

            const diffTime = expDate.getTime() - now.getTime();

            daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (daysUntilExpiry < 0) {

                isExpired = true;

            } else if (daysUntilExpiry <= 30) {

                isExpiringSoon = true;

            }

        }

    }



    const threshold = item.minStockThreshold || 10;

    const isBackorder = item.currentStock < 0;

    const isZero = item.currentStock === 0;

    const isLowStock = item.currentStock <= threshold && item.currentStock > 0;



    let state: StockHealthState = 'healthy';

    if (isExpired) state = 'expired';

    else if (isBackorder || isZero) state = 'critical';

    else if (isLowStock) state = 'low';

    else if (isExpiringSoon) state = 'expiring_soon';



    const denom = Math.max(item.initialStock || 1, item.currentStock || 1, threshold * 2);

    const capacityPercentage = Math.min(100, Math.max(0, Math.round((Math.max(0, item.currentStock) / denom) * 100)));



    return {

        state,

        isExpired,

        isExpiringSoon,

        isLowStock,

        isBackorder,

        isZero,

        daysUntilExpiry,

        capacityPercentage

    };

}



/* ─────────────────────────────────────────────────────────────

   Animated Counter Hook (Respects Reduced Motion)

   ───────────────────────────────────────────────────────────── */

function AnimatedNumber({ value, prefix = "", suffix = "", formatter }: { value: number; prefix?: string; suffix?: string; formatter?: (n: number) => string }) {

    const [displayVal, setDisplayVal] = useState(value);

    const prevValue = useRef(value);



    useEffect(() => {

        if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {

            setDisplayVal(value);

            prevValue.current = value;

            return;

        }



        const start = prevValue.current;

        const end = value;

        if (start === end) return;



        const duration = 500;

        let startTime: number | null = null;

        let animationFrame: number;



        const step = (timestamp: number) => {

            if (!startTime) startTime = timestamp;

            const progress = Math.min((timestamp - startTime) / duration, 1);

            const eased = 1 - Math.pow(1 - progress, 3);

            const current = Math.round(start + (end - start) * eased);

            setDisplayVal(current);



            if (progress < 1) {

                animationFrame = requestAnimationFrame(step);

            } else {

                setDisplayVal(end);

                prevValue.current = end;

            }

        };



        animationFrame = requestAnimationFrame(step);

        return () => cancelAnimationFrame(animationFrame);

    }, [value]);



    const formatted = formatter ? formatter(displayVal) : displayVal.toLocaleString("en-IN");

    return <span>{prefix}{formatted}{suffix}</span>;

}



/* ─────────────────────────────────────────────────────────────

   Cloud Inventory Types & Hooks (100% Unchanged Backend Logic)

   ───────────────────────────────────────────────────────────── */

export interface CloudInventoryItem {

    id: string;

    name: string;

    dosage: string;

    type: string;

    category: 'medications' | 'vaccinations' | 'blood_tests' | 'consumables' | string;

    price: number;

    usedForAge: string;

    description: string;

    initialStock: number;

    dispensed: number;

    currentStock: number;

    department?: string;

    subCategory?: string;

    tags?: string[];

    location?: string;

    purchaseUnit?: string;

    dispenseUnit?: string;

    conversionFactor?: number;

    arrivalDate?: string;

    expiryDate?: string;

    batchNumber?: string;

    imageUrl?: string;

    minStockThreshold?: number;

    supplier?: string;



    specification?: string;

    isSterile?: boolean;

    hasExpiry?: boolean;

    fundingSource?: string;

    storageTemp?: string;

    requiresReconstitution?: boolean;



    customFields?: Record<string, string>;

}



export interface CloudInventoryLog {

    id: string;

    itemId: string;

    itemName: string;

    actionType: 'dispense' | 'refill' | 'wastage';

    quantity: number;

    date: Date;

    patientName?: string;

    notes?: string;

}



function useCloudInventory(category: string) {

    const { user, firestore } = useFirebase();

    const { toast } = useToast();

    const [items, setItems] = useState<CloudInventoryItem[]>([]);

    const [loading, setLoading] = useState(true);



    useEffect(() => {

        if (!user || !firestore || !category) return;

        setLoading(true);

        const q = query(collection(firestore, "doctors", user.uid, "inventory_management_stocks"), where("category", "==", category), limit(1000));



        const unsub = onSnapshot(q, (snap) => {

            const fetched = snap.docs.map(doc => {

                const data = doc.data();

                const initial = data.initialStock || 0;

                const dispensed = data.dispensed || 0;

                return {

                    id: doc.id,

                    name: safeDecrypt(data.name),

                    dosage: safeDecrypt(data.dosage),

                    type: safeDecrypt(data.type),

                    category: data.category,

                    price: data.price || 0,

                    usedForAge: safeDecrypt(data.usedForAge),

                    description: safeDecrypt(data.description),

                    initialStock: initial,

                    dispensed: dispensed,

                    currentStock: initial - dispensed, 

                    department: data.department || '',

                    subCategory: data.subCategory || '',

                    tags: data.tags || [],

                    location: data.location || '',

                    purchaseUnit: data.purchaseUnit || '',

                    dispenseUnit: data.dispenseUnit || '',

                    conversionFactor: data.conversionFactor || 1,

                    arrivalDate: data.arrivalDate || '',

                    expiryDate: data.expiryDate || '',

                    batchNumber: data.batchNumber || '',

                    imageUrl: data.imageUrl || '',

                    minStockThreshold: data.minStockThreshold || 10,

                    supplier: data.supplier || '',

                    specification: data.specification || '',

                    isSterile: data.isSterile || false,

                    hasExpiry: data.hasExpiry ?? true,

                    fundingSource: data.fundingSource || "Private / Clinic Stock",

                    storageTemp: data.storageTemp || "Refrigerated 2°C to 8°C",

                    requiresReconstitution: data.requiresReconstitution || false,

                    customFields: data.customFields || {},

                } as CloudInventoryItem;

            });

            setItems(fetched.sort((a, b) => a.name.localeCompare(b.name)));

            setLoading(false);

        }, (error) => {

            console.error("Inventory Fetch Error:", error);

            setLoading(false);

            toast({ variant: "destructive", title: "Sync Error", description: "Could not load inventory items." });

        });



        return () => unsub();

    }, [user, firestore, category, toast]);



    return { items, loading };

}



function useCloudInventoryLogs(isActive: boolean) {

    const { user, firestore } = useFirebase();

    const [logs, setLogs] = useState<CloudInventoryLog[]>([]);



    useEffect(() => {

        if (!user || !firestore || !isActive) return;

        const q = query(collection(firestore, "doctors", user.uid, "inventory_management_logs"), limit(1000));



        const unsub = onSnapshot(q, (snap) => {

            const fetched = snap.docs.map(doc => {

                const data = doc.data();

                return {

                    id: doc.id,

                    itemId: data.itemId,

                    itemName: safeDecrypt(data.itemName),

                    patientName: safeDecrypt(data.patientName),

                    actionType: data.actionType,

                    quantity: data.quantity,

                    notes: safeDecrypt(data.notes),

                    date: data.date?.toDate() || new Date(),

                } as CloudInventoryLog;

            });

            setLogs(fetched.sort((a, b) => b.date.getTime() - a.date.getTime()));

        });

        return () => unsub();

    }, [user, firestore, isActive]);



    return logs;

}



/* ─────────────────────────────────────────────────────────────

   Inline Editable Cell Component (The "Excel" Feel)

   ───────────────────────────────────────────────────────────── */

function EditableCell({ value, onSave, type = "text", prefix = "", className = "" }: { value: string | number, onSave: (val: string) => void, type?: string, prefix?: string, className?: string }) {

    const [isEditing, setIsEditing] = useState(false);

    const [val, setVal] = useState(value?.toString() || "");



    useEffect(() => { setVal(value?.toString() || ""); }, [value]);



    const handleSave = () => {

        setIsEditing(false);

        if (val !== value?.toString()) onSave(val);

    };



    if (isEditing) {

        return (

            <Input 

                autoFocus 

                type={type} 

                value={val} 

                onChange={e => setVal(e.target.value)} 

                onBlur={handleSave} 

                onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setVal(value?.toString() || ""); setIsEditing(false); } }} 

                className={cn("h-7 text-xs w-full min-w-[68px] p-1.5 border-purple-500 bg-white shadow-sm focus-visible:ring-purple-300 rounded-md", className)} 

            />

        );

    }

    return (

        <div 

            onClick={() => setIsEditing(true)} 

            title="Click to inline edit"

            className={cn(

                "cursor-pointer px-1.5 py-1 -mx-1.5 -my-1 rounded-md transition-all duration-150 border border-transparent hover:border-purple-200 min-h-[24px] flex items-center", 

                !value && value !== 0 ? "border-dashed border-purple-100 text-slate-300 italic text-[11px] bg-purple-50/30 hover:bg-purple-50" : "hover:bg-purple-50/70", 

                className

            )}

        >

            {!value && value !== 0 ? "Empty" : `${prefix}${value}`}

        </div>

    );

}



/* ─────────────────────────────────────────────────────────────

   Spacious Hero Medical SVG Illustration Zone & Card Watermarks

   ───────────────────────────────────────────────────────────── */

function HeroMedicalIllustrationShowcase() {

    return (

        <div className="group/hero relative w-full rounded-2xl bg-gradient-to-br from-[#f6f0ff] via-[#f3e8ff]/85 to-[#fae8ff]/70 border border-purple-200/70 px-4 py-3.5 sm:px-6 sm:py-4 overflow-hidden shadow-inner transition-all duration-500 hover:border-purple-300 hover:shadow-lg hover:shadow-purple-500/10 select-none">

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

            <div className="relative z-10 w-full h-36 sm:h-44 flex items-center justify-center">

                <svg viewBox="0 0 700 200" className="w-full h-full max-w-[680px] overflow-visible">

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

                            <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#9333ea" floodOpacity="0.22" />

                        </filter>

                    </defs>



                    {/* Molecular Constellation Nodes */}

                    <g stroke="#c084fc" strokeWidth="1.2" opacity="0.45" fill="none">

                        <polyline points="55,55 95,38 130,65 98,95 55,55" />

                        <line x1="130" y1="65" x2="168" y2="50" />

                        <polyline points="545,145 585,120 625,148 595,175 545,145" />

                        <line x1="585" y1="120" x2="610" y2="85" />

                    </g>

                    <g className="panacea-node-pulse" fill="#a855f7">

                        <circle cx="55" cy="55" r="3.5" />

                        <circle cx="95" cy="38" r="2.8" />

                        <circle cx="130" cy="65" r="4" />

                        <circle cx="98" cy="95" r="2.5" />

                        <circle cx="168" cy="50" r="3" />

                        <circle cx="545" cy="145" r="3" />

                        <circle cx="585" cy="120" r="4" />

                        <circle cx="625" cy="148" r="3" />

                        <circle cx="610" cy="85" r="2.5" />

                    </g>



                    {/* Intersecting Orbital Rings */}

                    <g transform="translate(350, 102)">

                        <ellipse

                            rx="215"

                            ry="52"

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

                            ry="68"

                            transform="rotate(24)"

                            fill="none"

                            stroke="#d8b4fe"

                            strokeWidth="1.8"

                            opacity="0.7"

                        />

                    </g>



                    {/* Medical Cross Symbols */}

                    <g stroke="#c084fc" strokeWidth="3" strokeLinecap="round" opacity="0.65">

                        <line x1="136" y1="138" x2="162" y2="138" />

                        <line x1="149" y1="125" x2="149" y2="151" />

                        <line x1="546" y1="54" x2="572" y2="54" />

                        <line x1="559" y1="41" x2="559" y2="67" />

                    </g>



                    {/* Floating Orbital Spheres */}

                    <circle cx="152" cy="70" r="8" fill="#d8b4fe" opacity="0.85" />

                    <circle cx="525" cy="138" r="7.5" fill="#d8b4fe" opacity="0.85" />

                    <circle cx="265" cy="36" r="4.5" fill="#a855f7" opacity="0.45" />

                    <circle cx="445" cy="166" r="5" fill="#e879f9" opacity="0.55" />



                    {/* Left Floating Capsule */}

                    <g className="panacea-pill-l" style={{ transformOrigin: "200px 85px" }}>

                        <g transform="translate(158, 65) rotate(-25)" filter="url(#softPurpleGlow)">

                            <rect x="0" y="0" width="84" height="36" rx="18" fill="url(#heroCapsuleGrad)" stroke="#a855f7" strokeWidth="2" />

                            <line x1="42" y1="0" x2="42" y2="36" stroke="#a855f7" strokeWidth="1.8" />

                            <path d="M 14 9 H 34" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.9" />

                        </g>

                    </g>



                    {/* Right Floating Capsule */}

                    <g className="panacea-pill-r" style={{ transformOrigin: "485px 115px" }}>

                        <g transform="translate(456, 92) rotate(30)" filter="url(#softPurpleGlow)">

                            <rect x="0" y="0" width="58" height="26" rx="13" fill="url(#heroCapsuleGrad)" stroke="#a855f7" strokeWidth="1.8" />

                            <line x1="29" y1="0" x2="29" y2="26" stroke="#a855f7" strokeWidth="1.6" />

                        </g>

                    </g>



                    {/* Center Vaccine / Medicine Vial */}

                    <g className="panacea-vial-float" style={{ transformOrigin: "350px 100px" }}>

                        <g transform="translate(306, 26) rotate(7)" filter="url(#softPurpleGlow)">

                            <rect x="24" y="0" width="44" height="15" rx="5" fill="url(#heroVialCap)" />

                            <rect x="13" y="14" width="66" height="18" rx="6" fill="#d8b4fe" stroke="#9333ea" strokeWidth="2" />

                            <rect x="6" y="30" width="80" height="106" rx="16" fill="url(#heroVialBody)" stroke="#9333ea" strokeWidth="2.2" />

                            <rect x="16" y="46" width="60" height="58" rx="9" fill="#faf5ff" />

                            <g stroke="#7e22ce" strokeWidth="4.5" strokeLinecap="round">

                                <line x1="46" y1="64" x2="46" y2="86" />

                                <line x1="35" y1="75" x2="57" y2="75" />

                            </g>

                            <rect x="18" y="112" width="56" height="11" rx="5.5" fill="#faf5ff" opacity="0.9" />

                            <path d="M 13 42 V 120" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.45" />

                        </g>

                    </g>

                </svg>

            </div>



            <p className="relative z-10 text-center text-[11px] font-semibold text-purple-600/75 mt-0.5">

                Real-time stock telemetry • Automated low-stock & cold-chain expiry intelligence

            </p>

        </div>

    );

}



function CardMedicalSvgWatermark({ category }: { category: string }) {

    return (

        <div className="pointer-events-none select-none absolute -right-3 -bottom-3 w-36 h-36 opacity-[0.07] group-hover:opacity-[0.14] group-hover:scale-110 group-hover:-rotate-6 transition-all duration-300 ease-out z-0 overflow-hidden">

            {category === "vaccinations" ? (

                <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="#7c3aed" strokeWidth="2.2">

                    <circle cx="65" cy="65" r="42" strokeDasharray="5 5" opacity="0.6" />

                    <rect x="44" y="28" width="32" height="10" rx="3" />

                    <rect x="38" y="38" width="44" height="58" rx="9" />

                    <path d="M 48 64 H 72 M 60 52 V 76" strokeWidth="3" strokeLinecap="round" />

                    <line x1="22" y1="22" x2="35" y2="35" strokeLinecap="round" />

                    <circle cx="28" cy="85" r="4" />

                </svg>

            ) : category === "blood_tests" ? (

                <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="#7c3aed" strokeWidth="2.2">

                    <polygon points="60,18 92,36 92,74 60,92 28,74 28,36" opacity="0.55" />

                    <rect x="48" y="24" width="24" height="68" rx="12" transform="rotate(18 60 58)" />

                    <line x1="42" y1="54" x2="74" y2="64" strokeLinecap="round" />

                    <circle cx="32" cy="36" r="4" fill="#7c3aed" />

                    <circle cx="92" cy="74" r="4" fill="#7c3aed" />

                </svg>

            ) : category === "consumables" ? (

                <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="#7c3aed" strokeWidth="2.2">

                    <circle cx="60" cy="60" r="44" opacity="0.45" />

                    <rect x="34" y="34" width="52" height="52" rx="14" />

                    <path d="M 60 46 V 74 M 46 60 H 74" strokeWidth="3.2" strokeLinecap="round" />

                    <circle cx="28" cy="30" r="3" />

                    <circle cx="92" cy="90" r="3.5" />

                </svg>

            ) : (

                <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" stroke="#7c3aed" strokeWidth="2.2">

                    <ellipse cx="62" cy="62" rx="48" ry="22" transform="rotate(-28 62 62)" strokeDasharray="4 6" opacity="0.6" />

                    <g transform="translate(28, 44) rotate(-28)">

                        <rect x="0" y="0" width="66" height="30" rx="15" />

                        <line x1="33" y1="0" x2="33" y2="30" />

                    </g>

                    <circle cx="84" cy="32" r="9" opacity="0.7" />

                    <line x1="78" y1="32" x2="90" y2="32" />

                    <circle cx="30" cy="86" r="4" />

                </svg>

            )}

        </div>

    );

}



/* ─────────────────────────────────────────────────────────────

   Add / Edit Inventory Item Dialog (All Logic Preserved)

   ───────────────────────────────────────────────────────────── */

function AddInventoryItemDialog({ open, onOpenChange, currentTab, editingItem, clearEdit, dynamicCols, onItemSaved }: { open: boolean; onOpenChange: (open: boolean) => void; currentTab: string; editingItem: CloudInventoryItem | null; clearEdit: () => void; dynamicCols: string[]; onItemSaved?: (id: string) => void }) {

    const { toast } = useToast();

    const { user, firestore } = useFirebase();

    const [isSaving, setIsSaving] = useState(false);

    const [formPage, setFormPage] = useState<1 | 2>(1);



    // Standard Fields

    const [name, setName] = useState("");

    const [dosage, setDosage] = useState("");

    const [type, setType] = useState("Tablet"); 

    const [customType, setCustomType] = useState("");

    const [category, setCategory] = useState("medications");

    const [price, setPrice] = useState("");

    const [initialStock, setInitialStock] = useState("");

    const [usedForAge, setUsedForAge] = useState("");

    const [description, setDescription] = useState("");



    // Elite Fields

    const [subCategory, setSubCategory] = useState("");

    const [customSubCategory, setCustomSubCategory] = useState("");

    const [location, setLocation] = useState("");

    const [selectedTags, setSelectedTags] = useState<string[]>([]);

    const [purchaseUnit, setPurchaseUnit] = useState("Box");

    const [dispenseUnit, setDispenseUnit] = useState("Piece");

    const [conversionFactor, setConversionFactor] = useState("100");

    const [boxesAdded, setBoxesAdded] = useState("1");

    // Detailed Tracking

    const [arrivalDate, setArrivalDate] = useState("");

    const [expiryDate, setExpiryDate] = useState("");

    const [batchNumber, setBatchNumber] = useState("");

    const [imageFile, setImageFile] = useState<File | null>(null);

    const [imagePreview, setImagePreview] = useState("");

    const [minStockThreshold, setMinStockThreshold] = useState("10");

    const [supplier, setSupplier] = useState("");



    // Consumables Specific

    const [specification, setSpecification] = useState("");

    const [isSterile, setIsSterile] = useState(false);

    const [hasExpiry, setHasExpiry] = useState(true);



    // Vaccine Specific

    const [fundingSource, setFundingSource] = useState("Private / Clinic Stock");

    const [storageTemp, setStorageTemp] = useState("Refrigerated 2°C to 8°C");

    const [requiresReconstitution, setRequiresReconstitution] = useState(false);



    const [customFieldsArray, setCustomFieldsArray] = useState<{key: string, value: string}[]>([]);



    const activeFormCategory = editingItem ? editingItem.category : (currentTab === 'log' ? 'medications' : currentTab);



    const eliteTags = activeFormCategory === 'vaccinations' ? [

        { id: "#LiveAttenuated", label: "Live Attenuated", icon: Sparkles },

        { id: "#Inactivated", label: "Inactivated", icon: ShieldCheck },

        { id: "#MultiDose", label: "Multi-Dose", icon: Layers },

        { id: "#StrictColdChain", label: "Strict Cold Chain", icon: ThermometerSnowflake }

    ] : [

        { id: "#ColdStorage", label: "Cold Storage", icon: ThermometerSnowflake },

        { id: "#HighValue", label: "High Value", icon: CircleDollarSign },

        { id: "#FastMoving", label: "Fast Moving", icon: Zap },

        { id: "#LightSensitive", label: "Light Sensitive", icon: Moon }

    ];



    const toggleTag = (tagId: string) => setSelectedTags(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);

    const addCustomField = () => setCustomFieldsArray([...customFieldsArray, { key: "", value: "" }]);

    const updateCustomField = (index: number, key: string, value: string) => { const newArr = [...customFieldsArray]; newArr[index] = { key, value }; setCustomFieldsArray(newArr); };

    const removeCustomField = (index: number) => setCustomFieldsArray(customFieldsArray.filter((_, i) => i !== index));



    useEffect(() => {

        if (open) {

            const targetCat = editingItem ? editingItem.category : (currentTab === 'log' ? 'medications' : currentTab);

            setCategory(targetCat);

            setFormPage(1); 

            const seededCustomFields = dynamicCols.map(col => ({ key: col, value: "" }));



            if (targetCat === "consumables") {

                setSubCategory("General Exam Room Supplies");

                setDispenseUnit("Piece");

            } else if (targetCat === "blood_tests") {

                setSubCategory("Hematology");

                setDispenseUnit("Vial");

            } else if (targetCat === "vaccinations") {

                setSubCategory("Single-Dose Vial (SDV)");

                setPurchaseUnit("Vial");

                setDispenseUnit("Dose");

                setHasExpiry(true);

            }



            if (editingItem) {

                setName(editingItem.name || "");

                setDosage(editingItem.dosage || "");

                setType(editingItem.type || "Tablet");

                setPrice(editingItem.price?.toString() || "");

                setUsedForAge(editingItem.usedForAge || "");

                setDescription(editingItem.description || "");

                setSubCategory(editingItem.subCategory || "");

                setLocation(editingItem.location || "");

                setSelectedTags(editingItem.tags || []);

                setPurchaseUnit(editingItem.purchaseUnit || "Box");

                setDispenseUnit(editingItem.dispenseUnit || "Piece");

                setConversionFactor(editingItem.conversionFactor?.toString() || "100");

                setArrivalDate(editingItem.arrivalDate || "");

                setExpiryDate(editingItem.expiryDate || "");

                setBatchNumber(editingItem.batchNumber || "");

                setImagePreview(editingItem.imageUrl || "");

                setMinStockThreshold(editingItem.minStockThreshold?.toString() || "10");

                setSupplier(editingItem.supplier || "");

                setSpecification(editingItem.specification || "");

                setIsSterile(editingItem.isSterile || false);

                setHasExpiry(editingItem.hasExpiry ?? true);



                setFundingSource(editingItem.fundingSource || "Private / Clinic Stock");

                setStorageTemp(editingItem.storageTemp || "Refrigerated 2°C to 8°C");

                setRequiresReconstitution(editingItem.requiresReconstitution || false);

                if (editingItem.conversionFactor && editingItem.initialStock) {

                    setBoxesAdded(String(Math.floor(editingItem.initialStock / editingItem.conversionFactor)));

                }

                setInitialStock(editingItem.initialStock?.toString() || "");



                const mergedFields = [...seededCustomFields];

                if (editingItem.customFields) {

                    Object.entries(editingItem.customFields).forEach(([k, v]) => {

                        const existingIdx = mergedFields.findIndex(f => f.key === k);

                        if (existingIdx >= 0) mergedFields[existingIdx].value = v as string;

                        else mergedFields.push({ key: k, value: v as string });

                    });

                }

                setCustomFieldsArray(mergedFields);

            } else {

                setName(""); setDosage(""); setType("Tablet"); setCustomType(""); setPrice(""); setInitialStock(""); setUsedForAge(""); setDescription("");

                setLocation(""); setSelectedTags([]); setBoxesAdded("1"); setConversionFactor("100"); setCustomSubCategory("");

                setArrivalDate(""); setExpiryDate(""); setBatchNumber(""); setImageFile(null); setImagePreview("");

                setMinStockThreshold("10"); setSupplier(""); setSpecification(""); setIsSterile(false); setHasExpiry(true);

                setFundingSource("Private / Clinic Stock");

                setStorageTemp("Refrigerated 2°C to 8°C");

                setRequiresReconstitution(false);

                setCustomFieldsArray(seededCustomFields);

            }

        }

    }, [open, currentTab, editingItem, dynamicCols]);



    const handleSave = async (e: React.FormEvent) => {

        e.preventDefault();

        if (!name.trim() || !user || !firestore) return;



        setIsSaving(true);

        try {

            const itemId = editingItem ? editingItem.id : uuidv4();

            const finalType = type === "Other" ? customType.trim() : type;

            const finalSubCategory = subCategory === "Other" ? customSubCategory.trim() : subCategory;

            const finalPrice = Math.max(0, parseFloat(price) || 0); 

            const finalCustomFields: Record<string, string> = {};

            customFieldsArray.forEach(f => {

                if (f.key.trim() && f.value.trim()) finalCustomFields[f.key.trim()] = f.value.trim();

            });

            let calculatedInitialStock = 0;

            if (activeFormCategory === "blood_tests" || activeFormCategory === "consumables" || activeFormCategory === "vaccinations") {

                calculatedInitialStock = (parseInt(boxesAdded, 10) || 0) * (parseInt(conversionFactor, 10) || 1);

            } else {

                calculatedInitialStock = parseInt(initialStock, 10) || 0;

            }



            let uploadedImageUrl = "";

            if (imageFile && (activeFormCategory === "blood_tests" || activeFormCategory === "consumables" || activeFormCategory === "vaccinations")) {

                const fileRef = storageRef(getStorage(), `inventory_assets/${user.uid}/${Date.now()}_${imageFile.name}`);

                await uploadBytes(fileRef, imageFile);

                uploadedImageUrl = await getDownloadURL(fileRef);

            }



            const payload: any = {

                isEncryptedV1: false, 

                name: name.trim(),

                dosage: (activeFormCategory === "blood_tests" || activeFormCategory === "consumables") ? "" : dosage.trim(),

                type: finalType, 

                category: activeFormCategory,

                price: finalPrice,

                usedForAge: usedForAge.trim(),

                description: description.trim(),

                initialStock: calculatedInitialStock,

                ...(editingItem ? {} : { dispensed: 0, createdAt: serverTimestamp() }), 

                department: activeFormCategory === "blood_tests" ? "Laboratory" : activeFormCategory === "consumables" ? "Consumables" : "Clinical",

                minStockThreshold: parseInt(minStockThreshold, 10) || 10,

                supplier: supplier.trim(),

                customFields: finalCustomFields

            };



            if (activeFormCategory === "blood_tests" || activeFormCategory === "consumables" || activeFormCategory === "vaccinations") {

                payload.subCategory = finalSubCategory;

                payload.tags = selectedTags;

                payload.location = location.trim();

                payload.purchaseUnit = purchaseUnit;

                payload.dispenseUnit = dispenseUnit;

                payload.conversionFactor = parseInt(conversionFactor, 10) || 1;

                payload.arrivalDate = arrivalDate;

                payload.hasExpiry = hasExpiry;

                payload.expiryDate = hasExpiry ? expiryDate : "";

                payload.batchNumber = hasExpiry ? batchNumber.trim() : "";

                if (uploadedImageUrl) payload.imageUrl =