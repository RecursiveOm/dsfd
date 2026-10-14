"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { format, isValid, subMonths } from "date-fns";
import { v4 as uuidv4 } from "uuid";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
    Archive, PlusCircle, AlertTriangle, RefreshCw,
    History, Loader2, CheckCircle2, Database, Settings, Sparkles, TrendingUp, BarChart3, Search, Trash2, Download, ThermometerSnowflake, CircleDollarSign, Zap, Moon, UploadCloud, AlertOctagon, Edit2, ArrowRight, ArrowLeft, Plus, X, Box, Upload,
    Syringe, ShieldCheck, Layers, LayoutGrid, List, Filter, ArrowUpDown, Clock, PackageCheck, Pill, TestTube, ShieldAlert, MapPin, Building2, CalendarClock, Activity, Check, SlidersHorizontal, Eye
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

        const duration = 550;
        let startTime: number | null = null;
        let animationFrame: number;

        const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const progress = Math.min((timestamp - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // Cubic ease-out
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

    const formatted = formatter ? formatter(displayVal) : displayVal.toLocaleString();
    return <span>{prefix}{formatted}{suffix}</span>;
}

/* ─────────────────────────────────────────────────────────────
   Cloud Inventory Types & Hooks
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
    const [items, setItems] = useState < CloudInventoryItem[] > ([]);
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
    const [logs, setLogs] = useState < CloudInventoryLog[] > ([]);

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
   Decorative & Functional SVG Illustrations (Pure Light-Theme)
   ───────────────────────────────────────────────────────────── */
function HeroMedicalIllustration() {
    return (
        <div className="relative w-36 h-24 hidden lg:flex items-center justify-center select-none pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-tr from-purple-200/40 via-fuchsia-200/30 to-violet-100/20 rounded-full blur-2xl" />
            <svg viewBox="0 0 180 110" className="w-full h-full drop-shadow-sm overflow-visible">
                <defs>
                    <linearGradient id="vialBody" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                        <stop offset="100%" stopColor="#f3e8ff" stopOpacity="0.85" />
                    </linearGradient>
                    <linearGradient id="vialLiquid" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#a855f7" />
                        <stop offset="100%" stopColor="#7c3aed" />
                    </linearGradient>
                    <linearGradient id="capGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#9333ea" />
                        <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                    <linearGradient id="pillPink" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#e879f9" />
                        <stop offset="100%" stopColor="#a855f7" />
                    </linearGradient>
                </defs>
                {/* Floating Soft Rings */}
                <ellipse cx="95" cy="92" rx="58" ry="12" fill="#ede9fe" opacity="0.7" />
                <ellipse cx="95" cy="92" rx="40" ry="7" fill="#ddd6fe" opacity="0.5" />

                {/* Floating Capsule Left */}
                <g className="transition-transform duration-1000" transform="translate(22, 50) rotate(-28)">
                    <rect x="0" y="0" width="32" height="15" rx="7.5" fill="#ffffff" stroke="#e9d5ff" strokeWidth="1.5" />
                    <path d="M 0 7.5 A 7.5 7.5 0 0 1 7.5 0 L 16 0 L 16 15 L 7.5 15 A 7.5 7.5 0 0 1 0 7.5 Z" fill="url(#pillPink)" />
                </g>

                {/* Central Medicine Bottle */}
                <g transform="translate(68, 12) rotate(8)">
                    <rect x="11" y="0" width="26" height="9" rx="3" fill="url(#capGrad)" />
                    <rect x="14" y="9" width="20" height="5" fill="#e9d5ff" />
                    <rect x="4" y="14" width="40" height="58" rx="9" fill="url(#vialBody)" stroke="#d8b4fe" strokeWidth="1.5" />
                    <rect x="8" y="34" width="32" height="34" rx="6" fill="url(#vialLiquid)" opacity="0.9" />
                    <rect x="10" y="26" width="28" height="22" rx="4" fill="#ffffff" opacity="0.95" />
                    {/* Medical Cross */}
                    <path d="M22 32 H26 V35 H29 V39 H26 V42 H22 V39 H19 V35 H22 Z" fill="#9333ea" />
                    {/* Highlight */}
                    <path d="M9 19 V64" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
                </g>

                {/* Floating Blister / Secondary Vial Right */}
                <g transform="translate(128, 38) rotate(-14)">
                    <rect x="4" y="0" width="14" height="5" rx="2" fill="#7c3aed" />
                    <rect x="0" y="5" width="22" height="36" rx="5" fill="url(#vialBody)" stroke="#c4b5fd" strokeWidth="1.5" />
                    <rect x="3" y="18" width="16" height="20" rx="3" fill="#c084fc" opacity="0.75" />
                </g>

                {/* Sparkle Accents */}
                <circle cx="48" cy="24" r="3" fill="#a855f7" opacity="0.6" />
                <circle cx="148" cy="24" r="2.5" fill="#e879f9" opacity="0.7" />
                <circle cx="155" cy="70" r="3.5" fill="#8b5cf6" opacity="0.45" />
            </svg>
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
    const [formPage, setFormPage] = useState < 1 | 2 > (1);

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
    const [selectedTags, setSelectedTags] = useState < string[] > ([]);
    const [purchaseUnit, setPurchaseUnit] = useState("Box");
    const [dispenseUnit, setDispenseUnit] = useState("Piece");
    const [conversionFactor, setConversionFactor] = useState("100");
    const [boxesAdded, setBoxesAdded] = useState("1");

    // Detailed Tracking
    const [arrivalDate, setArrivalDate] = useState("");
    const [expiryDate, setExpiryDate] = useState("");
    const [batchNumber, setBatchNumber] = useState("");
    const [imageFile, setImageFile] = useState < File | null > (null);
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

    const [customFieldsArray, setCustomFieldsArray] = useState < { key: string, value: string }[] > ([]);

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
                if (uploadedImageUrl) payload.imageUrl = uploadedImageUrl;

                if (activeFormCategory === "consumables") {
                    payload.specification = specification.trim();
                    payload.isSterile = isSterile;
                }

                if (activeFormCategory === "vaccinations") {
                    payload.fundingSource = fundingSource;
                    payload.storageTemp = storageTemp;
                    payload.requiresReconstitution = requiresReconstitution;
                }
            }

            if (editingItem) {
                await updateDoc(doc(firestore, "doctors", user.uid, "inventory_management_stocks", editingItem.id), payload);
                toast({ title: "Asset Updated", description: `${name} updated successfully.` });
            } else {
                await setDoc(doc(firestore, "doctors", user.uid, "inventory_management_stocks", itemId), payload);
                await setDoc(doc(firestore, "doctors", user.uid, "inventory_management_logs", uuidv4()), {
                    isEncryptedV1: false, itemId, itemName: name.trim(), actionType: 'refill',
                    quantity: calculatedInitialStock, notes: "Initial Stock Setup", date: serverTimestamp(),
                });
                toast({ title: "Asset Added", description: `${name} added to inventory.` });
            }

            onItemSaved?.(itemId);
            onOpenChange(false);
            clearEdit();
        } catch (error) {
            toast({ variant: 'destructive', title: "Error", description: "Failed to save item." });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => { onOpenChange(val); if (!val) clearEdit(); }}>
            <DialogContent className="max-w-2xl rounded-3xl bg-white/95 backdrop-blur-xl border-purple-100 shadow-2xl transition-all duration-300 p-0 overflow-hidden">
                <div className="px-6 py-4 pr-14 border-b bg-gradient-to-r from-purple-50/90 via-violet-50/60 to-fuchsia-50/50 border-purple-100 flex flex-wrap justify-between items-center gap-3">
                    <div>
                        <DialogTitle className="flex items-center gap-2.5 text-lg font-extrabold text-purple-950">
                            <div className="w-8 h-8 rounded-xl bg-purple-600/10 border border-purple-200 flex items-center justify-center text-purple-700 shadow-xs">
                                {activeFormCategory === 'blood_tests' ? <Database className="w-4 h-4" /> : activeFormCategory === 'consumables' ? <Box className="w-4 h-4" /> : activeFormCategory === 'vaccinations' ? <Syringe className="w-4 h-4" /> : <Pill className="w-4 h-4" />}
                            </div>
                            {editingItem ? `Edit ${editingItem.name}` : (
                                activeFormCategory === 'blood_tests' ? "Add Laboratory Asset" :
                                    activeFormCategory === 'consumables' ? "Add Consumable / Supply" :
                                        activeFormCategory === 'vaccinations' ? "Add Vaccine to Cold-Chain Hub" :
                                            "Add Clinical Medication"
                            )}
                        </DialogTitle>
                        <DialogDescription className="text-[11px] text-purple-700/70 font-medium ml-10.5 mt-0.5">
                            Configure stock logistics, threshold alerts, and custom clinical attributes.
                        </DialogDescription>
                    </div>
                    <div className="flex bg-white/90 rounded-xl p-1 shadow-xs border border-purple-100">
                        <button type="button" onClick={() => setFormPage(1)} className={cn("px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5", formPage === 1 ? "bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-xs" : "text-slate-600 hover:bg-purple-50")}>
                            <span>1. Core Details</span>
                        </button>
                        <button type="button" onClick={() => setFormPage(2)} className={cn("px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5", formPage === 2 ? "bg-gradient-to-r from-purple-600 to-violet-600 text-white shadow-xs" : "text-slate-600 hover:bg-purple-50")}>
                            <span>2. Custom Columns</span>
                            {customFieldsArray.filter(f => f.key && f.value).length > 0 && (
                                <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", formPage === 2 ? "bg-white/20 text-white" : "bg-purple-100 text-purple-700")}>
                                    {customFieldsArray.filter(f => f.key && f.value).length}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSave} className="p-6 relative min-h-[340px] max-h-[80vh] overflow-y-auto">
                    <div className={cn("space-y-4 transition-all duration-300", formPage === 1 ? "opacity-100 translate-x-0 relative" : "opacity-0 -translate-x-full pointer-events-none hidden")}>

                        {/* ── CONSUMABLES TAB ── */}
                        {activeFormCategory === "consumables" && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
                                    <div className="md:col-span-3 space-y-3">
                                        <div className="grid grid-cols-3 gap-2.5">
                                            <div className="space-y-1 col-span-2">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Consumable Name *</Label>
                                                <Input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Hypodermic Needles" className="h-9 text-xs bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl shadow-xs" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Variant / Size</Label>
                                                <Input value={specification} onChange={e => setSpecification(e.target.value)} placeholder="e.g. 23G, Medium, 5ml" className="h-9 text-xs bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl shadow-xs" />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Sub-Category</Label>
                                                <Select value={subCategory} onValueChange={setSubCategory}>
                                                    <SelectTrigger className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl shadow-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent className="rounded-xl border-purple-100">
                                                        <SelectItem value="Respiratory & Inhalation">Respiratory & Inhalation</SelectItem>
                                                        <SelectItem value="Phlebotomy & IV Access">Phlebotomy & IV Access</SelectItem>
                                                        <SelectItem value="General Exam Room Supplies">General Exam Room Supplies</SelectItem>
                                                        <SelectItem value="Wound Care & Dressings">Wound Care & Dressings</SelectItem>
                                                        <SelectItem value="Hygiene, PPE & Safety">Hygiene, PPE & Safety</SelectItem>
                                                        <SelectItem value="Waste Management">Waste Management</SelectItem>
                                                        <SelectItem value="Minor Surgical / Procedural">Minor Surgical / Procedural</SelectItem>
                                                        <SelectItem value="Other">Custom...</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                {subCategory === "Other" && <Input value={customSubCategory} onChange={e => setCustomSubCategory(e.target.value)} placeholder="Type category..." className="h-8 mt-1.5 text-xs bg-purple-50 border-purple-200 rounded-lg" />}
                                            </div>
                                            <div className="flex flex-col justify-center gap-2 pt-2 pl-3 bg-purple-50/40 rounded-xl border border-purple-100/80 p-2">
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-[11px] font-bold text-slate-700 cursor-pointer" onClick={() => setIsSterile(!isSterile)}>Sterile Supply?</Label>
                                                    <Switch checked={isSterile} onCheckedChange={setIsSterile} className="data-[state=checked]:bg-emerald-500 scale-75" />
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <Label className="text-[11px] font-bold text-slate-700 cursor-pointer" onClick={() => setHasExpiry(!hasExpiry)}>Tracks Expiry?</Label>
                                                    <Switch checked={hasExpiry} onCheckedChange={setHasExpiry} className="data-[state=checked]:bg-purple-600 scale-75" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="border-2 border-dashed border-purple-200 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-purple-500 hover:bg-purple-50/40 transition-all h-full min-h-[100px] cursor-pointer bg-slate-50/60" onClick={() => document.getElementById("assetImageInput")?.click()}>
                                        {imagePreview ? <img src={imagePreview} alt="Preview" className="w-full h-full object-contain p-1.5 rounded-xl" /> : (
                                            <div className="flex flex-col items-center text-purple-400 gap-1.5 p-2 text-center">
                                                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <UploadCloud className="w-4 h-4 text-purple-600" />
                                                </div>
                                                <span className="text-[10px] font-bold text-purple-800">Upload Photo</span>
                                            </div>
                                        )}
                                        <input id="assetImageInput" type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files && e.target.files[0]) { setImageFile(e.target.files[0]); setImagePreview(URL.createObjectURL(e.target.files[0])); } }} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    <div className="bg-gradient-to-br from-purple-50/70 to-violet-50/40 border border-purple-100 rounded-2xl p-3 space-y-2.5">
                                        <Label className="text-[10px] font-extrabold uppercase tracking-wider text-purple-800 flex items-center gap-1.5"><Settings className="w-3.5 h-3.5 text-purple-600" /> High-Volume Logistics</Label>
                                        <div className="grid grid-cols-4 gap-2">
                                            <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Bought In</Label><Input value={purchaseUnit} onChange={e => setPurchaseUnit(e.target.value)} className="h-8 text-xs bg-white rounded-lg shadow-2xs" /></div>
                                            <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Dispense In</Label><Input value={dispenseUnit} onChange={e => setDispenseUnit(e.target.value)} className="h-8 text-xs bg-white rounded-lg shadow-2xs" /></div>
                                            <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Units Per</Label><Input type="number" value={conversionFactor} onChange={e => setConversionFactor(e.target.value)} className="h-8 text-xs bg-white rounded-lg shadow-2xs" /></div>
                                            <div className="space-y-1"><Label className="text-[9px] uppercase text-purple-700 font-bold">Qty Added</Label><Input type="number" required value={boxesAdded} onChange={e => setBoxesAdded(e.target.value)} className="h-8 text-xs font-bold bg-white border-purple-300 rounded-lg shadow-2xs" /></div>
                                        </div>
                                        <div className="flex justify-between items-center text-[11px] font-bold text-purple-900 bg-white/80 border border-purple-100 py-1.5 px-3 rounded-xl">
                                            <span>Total Stock: <span className="text-purple-700 font-black">{boxesAdded && conversionFactor ? parseInt(boxesAdded) * parseInt(conversionFactor) : 0} {dispenseUnit}s</span></span>
                                            {price && conversionFactor && parseInt(conversionFactor) > 0 && <span className="text-xs text-purple-600">₹{(parseFloat(price) / parseInt(conversionFactor)).toFixed(2)} / unit</span>}
                                        </div>
                                    </div>

                                    <div className="space-y-2.5">
                                        {hasExpiry ? (
                                            <div className="grid grid-cols-2 gap-2.5">
                                                <div className="space-y-1"><Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Batch No.</Label><Input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="e.g. LOT-98A" className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" /></div>
                                                <div className="space-y-1"><Label className="text-[10px] font-bold uppercase tracking-wider text-red-600">Expiry Date</Label><Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} onClick={(e) => 'showPicker' in e.target && (e.target as any).showPicker()} className="h-9 text-xs border-red-200 bg-red-50/30 rounded-xl w-full cursor-pointer" /></div>
                                            </div>
                                        ) : (
                                            <div className="h-[58px] border border-dashed border-slate-200 rounded-xl flex items-center justify-center bg-slate-50/70 text-slate-400 text-xs font-bold">Non-Expiring Hardware / Supply</div>
                                        )}
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Physical Location</Label>
                                            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Supply Closet B, Shelf 3" className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── BLOOD TESTS TAB ── */}
                        {activeFormCategory === "blood_tests" && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
                                    <div className="md:col-span-3 space-y-3">
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Asset Name *</Label>
                                                <Input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Lipid Profile Reagent" className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Sub-Category</Label>
                                                <Select value={subCategory} onValueChange={setSubCategory}>
                                                    <SelectTrigger className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl"><SelectValue /></SelectTrigger>
                                                    <SelectContent className="rounded-xl border-purple-100">
                                                        <SelectItem value="Hematology">Hematology</SelectItem>
                                                        <SelectItem value="Biochemistry">Biochemistry</SelectItem>
                                                        <SelectItem value="Immunology">Immunology</SelectItem>
                                                        <SelectItem value="Pathology">Pathology</SelectItem>
                                                        <SelectItem value="Other">Custom...</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                {subCategory === "Other" && <Input autoFocus value={customSubCategory} onChange={e => setCustomSubCategory(e.target.value)} placeholder="Type category..." className="h-8 mt-1.5 text-xs bg-purple-50 border-purple-200 rounded-lg" />}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2.5">
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Batch / Lot No.</Label>
                                                <Input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="e.g. BT-2026" className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Arrival Date</Label>
                                                <Input type="date" value={arrivalDate} onChange={e => setArrivalDate(e.target.value)} onClick={(e) => 'showPicker' in e.target && (e.target as any).showPicker()} className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl w-full block cursor-pointer" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-red-600">Expiry Date</Label>
                                                <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} onClick={(e) => 'showPicker' in e.target && (e.target as any).showPicker()} className="h-9 text-xs border-red-200 bg-red-50/30 rounded-xl w-full block cursor-pointer" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="border-2 border-dashed border-purple-200 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-purple-500 hover:bg-purple-50/40 transition-all h-full min-h-[100px] cursor-pointer bg-slate-50/60" onClick={() => document.getElementById("assetImageInput")?.click()}>
                                        {imagePreview ? <img src={imagePreview} alt="Preview" className="w-full h-full object-contain p-1.5 rounded-xl" /> : (
                                            <div className="flex flex-col items-center text-purple-400 gap-1.5 p-2 text-center">
                                                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <UploadCloud className="w-4 h-4 text-purple-600" />
                                                </div>
                                                <span className="text-[10px] font-bold text-purple-800">Upload Photo</span>
                                            </div>
                                        )}
                                        <input id="assetImageInput" type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files && e.target.files[0]) { setImageFile(e.target.files[0]); setImagePreview(URL.createObjectURL(e.target.files[0])); } }} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    <div className="bg-gradient-to-br from-purple-50/70 to-violet-50/40 border border-purple-100 rounded-2xl p-3 space-y-2.5">
                                        <Label className="text-[10px] font-extrabold uppercase tracking-wider text-purple-800 flex items-center gap-1.5"><Settings className="w-3.5 h-3.5 text-purple-600" /> Unit Conversion (Parent ➔ Child)</Label>
                                        <div className="grid grid-cols-4 gap-2">
                                            <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Bought In</Label><Input value={purchaseUnit} onChange={e => setPurchaseUnit(e.target.value)} className="h-8 text-xs bg-white rounded-lg" /></div>
                                            <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Dispense In</Label><Input value={dispenseUnit} onChange={e => setDispenseUnit(e.target.value)} className="h-8 text-xs bg-white rounded-lg" /></div>
                                            <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Units Per</Label><Input type="number" value={conversionFactor} onChange={e => setConversionFactor(e.target.value)} className="h-8 text-xs bg-white rounded-lg" /></div>
                                            <div className="space-y-1"><Label className="text-[9px] uppercase text-purple-700 font-bold">Qty Added</Label><Input type="number" required value={boxesAdded} onChange={e => setBoxesAdded(e.target.value)} className="h-8 text-xs font-bold bg-white border-purple-300 rounded-lg" /></div>
                                        </div>
                                        <div className="flex justify-between items-center text-[11px] font-bold text-purple-900 bg-white/80 border border-purple-100 py-1.5 px-3 rounded-xl">
                                            <span>Auto-Calc: <span className="text-purple-700 font-black">{boxesAdded && conversionFactor ? parseInt(boxesAdded) * parseInt(conversionFactor) : 0} {dispenseUnit}s</span></span>
                                            {price && conversionFactor && parseInt(conversionFactor) > 0 && <span className="text-xs text-purple-600">₹{(parseFloat(price) / parseInt(conversionFactor)).toFixed(2)} / unit</span>}
                                        </div>
                                    </div>

                                    <div className="space-y-2.5">
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Physical Location</Label>
                                            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Lab Fridge A, Rack 2" className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700 block">Clinical Asset Tags</Label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {eliteTags.map(tag => (
                                                    <button type="button" key={tag.id} onClick={() => toggleTag(tag.id)} className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border flex items-center gap-1", selectedTags.includes(tag.id) ? "bg-purple-600 text-white border-purple-600 shadow-xs" : "bg-white text-slate-600 border-purple-100 hover:border-purple-300 hover:text-purple-700")}>
                                                        <tag.icon className="w-3 h-3" /> {tag.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── VACCINATIONS TAB ── */}
                        {activeFormCategory === "vaccinations" && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
                                    <div className="md:col-span-3 space-y-3">
                                        <div className="grid grid-cols-4 gap-2.5">
                                            <div className="space-y-1 col-span-2">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Vaccine Name / Antigen *</Label>
                                                <Input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. DTaP, MMR, BCG" className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" />
                                            </div>
                                            <div className="space-y-1 col-span-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Brand / Mfg</Label>
                                                <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Serum Inst." className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" />
                                            </div>
                                            <div className="space-y-1 col-span-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Patient Age</Label>
                                                <Input value={usedForAge} onChange={e => setUsedForAge(e.target.value)} placeholder="e.g. <7 yrs" className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2.5">
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Funding / Stock</Label>
                                                <Select value={fundingSource} onValueChange={setFundingSource}>
                                                    <SelectTrigger className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl"><SelectValue /></SelectTrigger>
                                                    <SelectContent className="rounded-xl border-purple-100">
                                                        <SelectItem value="Private / Clinic Stock">Private / Clinic Stock</SelectItem>
                                                        <SelectItem value="Government / State-Funded">Government / State-Funded</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Packaging Type</Label>
                                                <Select value={subCategory} onValueChange={setSubCategory}>
                                                    <SelectTrigger className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl"><SelectValue /></SelectTrigger>
                                                    <SelectContent className="rounded-xl border-purple-100">
                                                        <SelectItem value="Single-Dose Vial (SDV)">Single-Dose Vial (SDV)</SelectItem>
                                                        <SelectItem value="Multi-Dose Vial (MDV)">Multi-Dose Vial (MDV)</SelectItem>
                                                        <SelectItem value="Pre-filled Syringe (PFS)">Pre-filled Syringe (PFS)</SelectItem>
                                                        <SelectItem value="Oral Tube">Oral Tube</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Storage Temp</Label>
                                                <Select value={storageTemp} onValueChange={setStorageTemp}>
                                                    <SelectTrigger className="h-9 text-xs border-blue-200 bg-blue-50/40 rounded-xl"><SelectValue /></SelectTrigger>
                                                    <SelectContent className="rounded-xl border-blue-100">
                                                        <SelectItem value="Refrigerated 2°C to 8°C">Refrigerated 2°C to 8°C</SelectItem>
                                                        <SelectItem value="Frozen -15°C to -50°C">Frozen -15°C to -50°C</SelectItem>
                                                        <SelectItem value="Ultra-Cold (-60°C to -90°C)">Ultra-Cold (-60°C to -90°C)</SelectItem>
                                                        <SelectItem value="Room Temp (Protect from light)">Room Temp (Protect from light)</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="border-2 border-dashed border-purple-200 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden group hover:border-purple-500 hover:bg-purple-50/40 transition-all h-full min-h-[100px] cursor-pointer bg-slate-50/60" onClick={() => document.getElementById("assetImageInput")?.click()}>
                                        {imagePreview ? <img src={imagePreview} alt="Preview" className="w-full h-full object-contain p-1.5 rounded-xl" /> : (
                                            <div className="flex flex-col items-center text-purple-400 gap-1.5 p-2 text-center">
                                                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <Syringe className="w-4 h-4 text-purple-600" />
                                                </div>
                                                <span className="text-[10px] font-bold text-purple-800">Upload Vial</span>
                                            </div>
                                        )}
                                        <input id="assetImageInput" type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files && e.target.files[0]) { setImageFile(e.target.files[0]); setImagePreview(URL.createObjectURL(e.target.files[0])); } }} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    <div className="space-y-2.5">
                                        <div className="bg-gradient-to-br from-purple-50/70 to-violet-50/40 border border-purple-100 rounded-2xl p-3 space-y-2.5">
                                            <Label className="text-[10px] font-extrabold uppercase tracking-wider text-purple-800 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-purple-600" /> Dosing & Logistics</Label>
                                            <div className="grid grid-cols-4 gap-2">
                                                <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Bought In</Label><Input value={purchaseUnit} onChange={e => setPurchaseUnit(e.target.value)} className="h-8 text-xs bg-white rounded-lg" /></div>
                                                <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Dispense In</Label><Input value={dispenseUnit} onChange={e => setDispenseUnit(e.target.value)} className="h-8 text-xs bg-white rounded-lg" /></div>
                                                <div className="space-y-1"><Label className="text-[9px] uppercase text-slate-500 font-semibold">Doses/Vial</Label><Input type="number" value={conversionFactor} onChange={e => setConversionFactor(e.target.value)} className="h-8 text-xs bg-white rounded-lg" /></div>
                                                <div className="space-y-1"><Label className="text-[9px] uppercase text-purple-700 font-bold">Vials Added</Label><Input type="number" required value={boxesAdded} onChange={e => setBoxesAdded(e.target.value)} className="h-8 text-xs font-bold bg-white border-purple-300 rounded-lg" /></div>
                                            </div>
                                            <div className="flex justify-between items-center text-[11px] font-bold text-purple-900 bg-white/80 border border-purple-100 py-1.5 px-3 rounded-xl">
                                                <span>Total Doses In Stock: <span className="text-purple-700 font-black text-sm ml-1">{boxesAdded && conversionFactor ? parseInt(boxesAdded) * parseInt(conversionFactor) : 0}</span> {dispenseUnit}s</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Cold-Chain Location</Label>
                                            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Main Fridge A, Top Shelf" className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" />
                                        </div>
                                    </div>

                                    <div className="space-y-2.5">
                                        <div className="grid grid-cols-2 gap-2.5">
                                            <div className="space-y-1"><Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Batch / Lot No. *</Label><Input required value={batchNumber} onChange={e => setBatchNumber(e.target.value)} className="h-9 text-xs bg-slate-50/70 border-purple-100 rounded-xl" /></div>
                                            <div className="space-y-1"><Label className="text-[10px] font-bold uppercase tracking-wider text-red-600">Strict Expiry Date *</Label><Input required type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} onClick={(e) => 'showPicker' in e.target && (e.target as any).showPicker()} className="h-9 text-xs border-red-200 bg-red-50/30 rounded-xl w-full cursor-pointer" /></div>
                                        </div>

                                        <div className="flex items-center justify-between bg-purple-50/50 p-2.5 rounded-xl border border-purple-100">
                                            <Label className="text-xs font-bold text-purple-950 cursor-pointer" onClick={() => setRequiresReconstitution(!requiresReconstitution)}>Requires Diluent / Reconstitution?</Label>
                                            <Switch checked={requiresReconstitution} onCheckedChange={setRequiresReconstitution} className="data-[state=checked]:bg-purple-600 scale-90" />
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700 block">Vaccine Classification Tags</Label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {eliteTags.map(tag => (
                                                    <button type="button" key={tag.id} onClick={() => toggleTag(tag.id)} className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border flex items-center gap-1", selectedTags.includes(tag.id) ? "bg-purple-600 text-white border-purple-600 shadow-xs" : "bg-white text-slate-600 border-purple-100 hover:border-purple-300 hover:text-purple-700")}>
                                                        <tag.icon className="w-3 h-3" /> {tag.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── STANDARD MEDICATIONS FORM ── */}
                        {(activeFormCategory !== "blood_tests" && activeFormCategory !== "consumables" && activeFormCategory !== "vaccinations") && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
                                    <div className="space-y-1.5 md:col-span-2">
                                        <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Medication Name *</Label>
                                        <Input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Dolo 650 / Paracetamol" className="h-10 text-xs bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl shadow-xs" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Strength / Dosage</Label>
                                        <Input value={dosage} onChange={e => setDosage(e.target.value)} placeholder="e.g. 650mg, 5ml" className="h-10 text-xs bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl shadow-xs" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Formulation Type</Label>
                                        <Select value={type} onValueChange={setType}>
                                            <SelectTrigger className="h-10 text-xs bg-slate-50/70 border-purple-100 rounded-xl shadow-xs"><SelectValue /></SelectTrigger>
                                            <SelectContent className="rounded-xl border-purple-100">
                                                <SelectItem value="Tablet">Tablet</SelectItem>
                                                <SelectItem value="Capsule">Capsule</SelectItem>
                                                <SelectItem value="Syrup">Syrup</SelectItem>
                                                <SelectItem value="Injection">Injection</SelectItem>
                                                <SelectItem value="Other">Other...</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        {type === "Other" && <Input autoFocus value={customType} onChange={e => setCustomType(e.target.value)} placeholder="Type custom..." className="h-8 mt-1.5 text-xs bg-purple-50 border-purple-200 rounded-lg" />}
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                                    <div className="space-y-1.5">
                                        <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Initial Stock Quantity *</Label>
                                        <Input type="number" required value={initialStock} onChange={e => setInitialStock(e.target.value)} placeholder="0" className="h-10 text-xs bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl shadow-xs font-bold" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Unit Price (₹)</Label>
                                        <Input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" className="h-10 text-xs bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl shadow-xs" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Target Age Group</Label>
                                        <Input value={usedForAge} onChange={e => setUsedForAge(e.target.value)} placeholder="Adults, Pediatrics, 12+" className="h-10 text-xs bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl shadow-xs" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Shared Procurement Fields across all forms */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-3 border-t border-purple-50">
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Low Stock Alert Threshold *</Label>
                                <Input type="number" required value={minStockThreshold} onChange={e => setMinStockThreshold(e.target.value)} placeholder="e.g. 10" className="h-10 text-xs bg-purple-50/40 rounded-xl shadow-xs font-bold border-purple-200" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Supplier / Distributor</Label>
                                <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Cipla, Medline, GSK" className="h-10 text-xs bg-slate-50/70 rounded-xl shadow-xs border-purple-100" />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">{['blood_tests', 'consumables', 'vaccinations'].includes(activeFormCategory) ? "Price per Parent Unit (₹)" : "Clinical Notes / Instructions"}</Label>
                                {['blood_tests', 'consumables', 'vaccinations'].includes(activeFormCategory) ? (
                                    <Input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" className="h-10 text-xs bg-slate-50/70 border-purple-100 rounded-xl shadow-xs font-bold" />
                                ) : (
                                    <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Dispensing notes..." className="h-10 text-xs bg-slate-50/70 rounded-xl shadow-xs border-purple-100" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ─── PAGE 2: CUSTOM FIELDS ─── */}
                    <div className={cn("space-y-4 transition-all duration-300", formPage === 2 ? "opacity-100 translate-x-0 relative z-10" : "opacity-0 translate-x-full pointer-events-none hidden")}>
                        <div className="bg-purple-50/60 border border-purple-100 rounded-2xl p-4 space-y-4 max-h-[300px] overflow-y-auto">
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label className="text-xs font-black tracking-wider uppercase text-purple-900 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-purple-600" /> Dynamic Custom Columns
                                    </Label>
                                    <p className="text-[11px] text-purple-700/70 mt-0.5">Custom fields automatically generate inline-editable columns in Table View.</p>
                                </div>
                                <Button type="button" onClick={addCustomField} variant="outline" size="sm" className="h-8 rounded-xl text-xs border-purple-200 text-purple-700 bg-white hover:bg-purple-100 shadow-2xs">
                                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Attribute
                                </Button>
                            </div>

                            {customFieldsArray.length === 0 ? (
                                <div className="text-center py-10 bg-white/70 rounded-xl border border-dashed border-purple-200 text-slate-400 text-xs font-medium">
                                    No custom attributes configured for this item.<br />Click "Add Attribute" or import an Excel sheet to populate dynamic columns.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {customFieldsArray.map((field, index) => (
                                        <div key={index} className="flex items-center gap-2 bg-white p-2 rounded-xl border border-purple-100 shadow-2xs">
                                            <Input placeholder="Column Name (e.g. Rack Code)" value={field.key} onChange={(e) => updateCustomField(index, e.target.value, field.value)} className="h-8 text-xs font-bold border-purple-100 bg-purple-50/30 w-2/5 rounded-lg" />
                                            <Input placeholder="Value (e.g. R-104)" value={field.value} onChange={(e) => updateCustomField(index, field.key, e.target.value)} className="h-8 text-xs border-slate-100 bg-slate-50/50 flex-1 rounded-lg" />
                                            <Button type="button" variant="ghost" size="icon" onClick={() => removeCustomField(index)} className="h-8 w-8 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg shrink-0"><X className="w-4 h-4" /></Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter className="pt-4 mt-5 border-t border-purple-100 flex items-center justify-between sm:justify-between w-full">
                        <div className="flex gap-2">
                            {formPage === 2 ? (
                                <Button type="button" variant="outline" onClick={() => setFormPage(1)} className="rounded-xl h-10 px-4 text-xs font-bold border-purple-200 text-purple-700 hover:bg-purple-50"><ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to Core</Button>
                            ) : (
                                <Button type="button" variant="outline" onClick={() => setFormPage(2)} className="rounded-xl h-10 px-4 text-xs font-bold border-purple-200 text-purple-700 hover:bg-purple-50">Custom Columns <ArrowRight className="w-3.5 h-3.5 ml-1.5" /></Button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" variant="ghost" onClick={() => { onOpenChange(false); clearEdit(); }} className="rounded-xl h-10 px-4 text-xs font-semibold text-slate-500">Cancel</Button>
                            <Button type="submit" disabled={isSaving} className="rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white shadow-md shadow-purple-200 h-10 px-6 text-xs font-bold">
                                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />} {editingItem ? "Update Asset" : "Save to Inventory"}
                            </Button>
                        </div>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

/* ─────────────────────────────────────────────────────────────
   Refill Stock Dialog (Enhanced Feedback & Quick Presets)
   ───────────────────────────────────────────────────────────── */
function RefillStockDialog({ item, triggerVariant = "pill", onRefillSuccess }: { item: CloudInventoryItem; triggerVariant?: "pill" | "card"; onRefillSuccess?: (id: string) => void }) {
    const { toast } = useToast();
    const { user, firestore } = useFirebase();
    const [quantityToAdd, setQuantityToAdd] = useState("");
    const [newBatch, setNewBatch] = useState("");
    const [newExpiry, setNewExpiry] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setNewBatch(item.batchNumber || "");
            setNewExpiry(item.expiryDate || "");
        }
    }, [isOpen, item]);

    const handleRefill = async () => {
        const qty = parseInt(quantityToAdd, 10);
        if (!qty || qty <= 0 || !user || !firestore) return;

        setIsSaving(true);
        try {
            const itemRef = doc(firestore, "doctors", user.uid, "inventory_management_stocks", item.id);
            const updatePayload: any = { initialStock: item.initialStock + qty };

            if (item.hasExpiry !== false && (newBatch || newExpiry)) {
                if (newBatch) updatePayload.batchNumber = newBatch;
                if (newExpiry) updatePayload.expiryDate = newExpiry;
            }

            await updateDoc(itemRef, updatePayload);

            await setDoc(doc(firestore, "doctors", user.uid, "inventory_management_logs", uuidv4()), {
                isEncryptedV1: false,
                itemId: item.id,
                itemName: item.name,
                actionType: 'refill',
                quantity: qty,
                notes: `Restock${newBatch ? ' Batch: ' + newBatch : ''}`,
                date: serverTimestamp(),
            });

            toast({ title: "Stock Refilled", description: `Added ${qty} units to ${item.name}.` });
            onRefillSuccess?.(item.id);
            setIsOpen(false);
            setQuantityToAdd(""); setNewBatch(""); setNewExpiry("");
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not refill stock.' });
        } finally {
            setIsSaving(false);
        }
    };

    const parsedAdd = parseInt(quantityToAdd, 10) || 0;
    const projectedStock = item.currentStock + parsedAdd;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {triggerVariant === "card" ? (
                    <Button size="sm" className="h-9 flex-1 rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white font-bold text-xs shadow-sm shadow-purple-200/80 transition-all active:scale-95">
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refill
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" className="h-8 rounded-full text-purple-700 border-purple-200 hover:bg-purple-100/70 font-semibold text-xs transition-all">
                        <RefreshCw className="w-3.5 h-3.5 sm:mr-1.5" /> <span className="hidden sm:inline">Refill</span>
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[420px] rounded-3xl bg-white/95 backdrop-blur-2xl border-purple-100 shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="text-xl font-extrabold text-purple-950 flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600">
                            <RefreshCw className="w-4 h-4" />
                        </div>
                        <span>Refill Stock: {item.name}</span>
                    </DialogTitle>
                    <DialogDescription className="text-xs text-purple-700/70 pl-11">
                        Log incoming inventory units and update batch tracking.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-2 space-y-4">
                    <div className="grid grid-cols-2 gap-2.5">
                        <div className={cn("p-3 rounded-2xl border flex flex-col justify-between", item.currentStock < 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-purple-50/60 border-purple-100")}>
                            <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">Current Available</span>
                            <strong className="text-2xl font-black mt-0.5">
                                {item.currentStock < 0 ? `0 (Backorder: ${Math.abs(item.currentStock)})` : item.currentStock}
                            </strong>
                        </div>
                        <div className="p-3 rounded-2xl border bg-emerald-50/60 border-emerald-200 text-emerald-800 flex flex-col justify-between">
                            <span className="text-[10px] uppercase font-bold tracking-wider opacity-75">Projected Total</span>
                            <strong className="text-2xl font-black mt-0.5 flex items-center gap-1">
                                {projectedStock}
                                {parsedAdd > 0 && <span className="text-xs font-bold bg-emerald-200/70 text-emerald-900 px-1.5 py-0.5 rounded-md">+{parsedAdd}</span>}
                            </strong>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700 ml-1">Quantity to Add ({item.dispenseUnit || 'Units'})</Label>
                            <div className="flex gap-1">
                                {[10, 50, 100, item.conversionFactor || 200].filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).map(preset => (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => setQuantityToAdd(String((parseInt(quantityToAdd, 10) || 0) + preset))}
                                        className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-100/80 text-purple-700 hover:bg-purple-200 transition-colors"
                                    >
                                        +{preset}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <Input
                            type="number"
                            min="1"
                            value={quantityToAdd}
                            onChange={(e) => setQuantityToAdd(e.target.value)}
                            placeholder={`e.g. ${item.conversionFactor || 100}`}
                            className="h-11 text-lg font-black rounded-xl border-purple-200 focus-visible:ring-purple-500 bg-white text-center shadow-xs"
                        />
                    </div>

                    {item.hasExpiry !== false && (item.category === 'blood_tests' || item.category === 'consumables' || item.category === 'vaccinations') && (
                        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-purple-100">
                            <div className="space-y-1">
                                <Label className="text-[10px] font-bold uppercase text-purple-700 ml-1">Updated Batch No.</Label>
                                <Input value={newBatch} onChange={e => setNewBatch(e.target.value)} className="h-9 text-xs rounded-xl border-purple-100" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-[10px] font-bold uppercase text-red-600 ml-1">Updated Expiry</Label>
                                <Input type="date" value={newExpiry} onChange={e => setNewExpiry(e.target.value)} onClick={(e) => 'showPicker' in e.target && (e.target as any).showPicker()} className="h-9 text-xs rounded-xl border-red-200 cursor-pointer" />
                            </div>
                        </div>
                    )}
                </div>
                <DialogFooter className="mt-2">
                    <Button variant="ghost" onClick={() => setIsOpen(false)} className="rounded-xl h-10 text-xs font-semibold">Cancel</Button>
                    <Button onClick={handleRefill} disabled={isSaving || !quantityToAdd || parsedAdd <= 0} className="rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 text-white hover:from-purple-700 hover:to-violet-700 transition-all shadow-md shadow-purple-200 h-10 px-6 text-xs font-bold">
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />} Confirm Refill
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/* ─────────────────────────────────────────────────────────────
   Log Wastage Dialog (All Logic Preserved)
   ───────────────────────────────────────────────────────────── */
function LogWastageDialog({ item, isExpired, onWastageLogged }: { item: CloudInventoryItem; isExpired?: boolean; onWastageLogged?: (id: string) => void }) {
    const { toast } = useToast();
    const { user, firestore } = useFirebase();
    const [quantityToWaste, setQuantityToWaste] = useState("");
    const [reason, setReason] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const handleWastage = async () => {
        const qty = parseInt(quantityToWaste, 10);
        if (!qty || qty <= 0) return;
        if (!user || !firestore) return;

        const freshCurrentStock = item.initialStock - item.dispensed;
        if (!isExpired && freshCurrentStock >= 0 && qty > freshCurrentStock) {
            toast({ title: "Insufficient stock", description: `Only ${freshCurrentStock} units available.` });
            return;
        }

        setIsSaving(true);
        try {
            const itemRef = doc(firestore, "doctors", user.uid, "inventory_management_stocks", item.id);
            await updateDoc(itemRef, { dispensed: item.dispensed + qty });

            const logRef = doc(firestore, "doctors", user.uid, "inventory_management_logs", uuidv4());
            await setDoc(logRef, {
                isEncryptedV1: false,
                itemId: item.id,
                itemName: item.name,
                actionType: 'wastage',
                quantity: qty,
                notes: `Wastage: ${reason || 'Not specified'}${isExpired ? ' (Expired item)' : ''}`,
                date: serverTimestamp(),
            });

            toast({ title: "Wastage Logged", description: `Deducted ${qty} units from ${item.name}.` });
            onWastageLogged?.(item.id);
            setIsOpen(false);
            setQuantityToWaste(""); setReason("");
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not log wastage.' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" title="Log Breakage/Wastage" className="text-amber-600 hover:text-amber-800 hover:bg-amber-50 h-8 w-8 rounded-xl transition-all">
                    <AlertOctagon className="w-4 h-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[400px] rounded-3xl bg-white/95 backdrop-blur-2xl border-orange-100 shadow-2xl">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-orange-950 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
                            <AlertOctagon className="w-4 h-4" />
                        </div>
                        Log Wastage: {item.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Record broken vials, expired reagents, or spilled medications.
                        {isExpired && <span className="block text-red-600 font-bold mt-1">⚠️ This item is expired – wastage will be recorded as disposal.</span>}
                    </DialogDescription>
                </DialogHeader>
                <div className="py-2 space-y-4">
                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-orange-700 ml-1">Quantity Lost / Disposed</Label>
                        <Input
                            type="number"
                            min="1"
                            max={isExpired ? 999999 : Math.max(0, item.currentStock)}
                            value={quantityToWaste}
                            onChange={(e) => setQuantityToWaste(e.target.value)}
                            placeholder={isExpired ? "Enter quantity to dispose" : `Max available: ${Math.max(0, item.currentStock)}`}
                            className="h-11 text-lg font-bold rounded-xl border-orange-200 focus-visible:ring-orange-500 bg-white shadow-xs"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-orange-700 ml-1">Reason / Disposal Note</Label>
                        <Input
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g. Dropped vial, cold-chain breach, expired batch..."
                            className="h-10 rounded-xl border-orange-200 focus-visible:ring-orange-500 bg-white shadow-xs text-xs"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsOpen(false)} className="rounded-xl text-xs">Cancel</Button>
                    <Button
                        onClick={handleWastage}
                        disabled={isSaving || !quantityToWaste}
                        className="rounded-xl bg-orange-500 hover:bg-orange-600 text-white transition-all shadow-md text-xs font-bold"
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Confirm Wastage
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function HighlightedText({ text, highlight }: { text: string; highlight: string }) {
    if (!highlight.trim() || !text) return <>{text}</>;
    const escapedHighlight = highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedHighlight})`, "gi");
    const parts = String(text).split(regex);
    return (
        <>
            {parts.map((part, i) =>
                regex.test(part) ? (
                    <mark key={i} className="bg-purple-200/90 text-purple-950 font-extrabold px-0.5 rounded-xs">
                        {part}
                    </mark>
                ) : (
                    <span key={i}>{part}</span>
                )
            )}
        </>
    );
}

/* ─────────────────────────────────────────────────────────────
   Premium Inventory Item Card Component (For Dual Card View)
   ───────────────────────────────────────────────────────────── */
function InventoryItemCard({
    item,
    highlightSearch,
    recentlyUpdated,
    onEdit,
    onDelete,
    onMutated
}: {
    item: CloudInventoryItem;
    highlightSearch: string;
    recentlyUpdated: boolean;
    onEdit: (item: CloudInventoryItem) => void;
    onDelete: (item: CloudInventoryItem) => void;
    onMutated: (id: string) => void;
}) {
    const health = evaluateItemHealth(item);

    const CategoryIcon = item.category === 'vaccinations' ? Syringe : item.category === 'blood_tests' ? TestTube : item.category === 'consumables' ? Box : Pill;

    const statusBadge = () => {
        switch (health.state) {
            case 'expired':
                return <Badge className="bg-red-600 text-white border-0 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full shadow-xs">Expired</Badge>;
            case 'critical':
                return (
                    <Badge className="bg-red-100 text-red-700 border border-red-200 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping" />
                        {health.isBackorder ? `Backorder (${Math.abs(item.currentStock)})` : 'Out of Stock'}
                    </Badge>
                );
            case 'low':
                return (
                    <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Low Stock
                    </Badge>
                );
            case 'expiring_soon':
                return (
                    <Badge className="bg-orange-100 text-orange-800 border border-orange-200 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Exp in {health.daysUntilExpiry}d
                    </Badge>
                );
            default:
                return (
                    <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        In Stock
                    </Badge>
                );
        }
    };

    const barColor =
        health.state === 'expired' ? 'from-slate-400 to-slate-500' :
            health.state === 'critical' ? 'from-red-500 to-rose-600' :
                health.state === 'low' ? 'from-amber-400 to-orange-500' :
                    health.state === 'expiring_soon' ? 'from-orange-400 to-amber-500' :
                        'from-emerald-400 via-teal-500 to-emerald-600';

    return (
        <div
            className={cn(
                "group relative rounded-2xl bg-white border transition-all duration-300 flex flex-col justify-between p-4 shadow-xs hover:shadow-xl hover:shadow-purple-500/8 hover:-translate-y-1",
                health.isExpired ? "border-red-200/80 bg-slate-50/70 opacity-85" :
                    health.state === 'critical' ? "border-red-200/90 hover:border-red-300" :
                        health.state === 'low' ? "border-amber-200/90 hover:border-amber-300" :
                            "border-purple-100/90 hover:border-purple-300",
                recentlyUpdated && "ring-2 ring-purple-500 bg-purple-50/40"
            )}
        >
            <div>
                {/* Top Status & Quick Action Bar */}
                <div className="flex items-center justify-between gap-2 mb-3">
                    {statusBadge()}
                    <div className="flex items-center gap-0.5">
                        <LogWastageDialog item={item} isExpired={health.isExpired} onWastageLogged={onMutated} />
                        <Button
                            variant="ghost"
                            size="icon"
                            title="Edit Details"
                            onClick={() => onEdit(item)}
                            className="h-8 w-8 rounded-xl text-slate-400 hover:text-purple-700 hover:bg-purple-50"
                        >
                            <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" title="Delete Asset" className="h-8 w-8 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="rounded-3xl border-red-100 shadow-2xl">
                                <AlertDialogHeader>
                                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-2 mx-auto">
                                        <AlertTriangle className="w-6 h-6 text-red-600" />
                                    </div>
                                    <AlertDialogTitle className="text-center text-red-600 text-xl">Delete {item.name}?</AlertDialogTitle>
                                    <AlertDialogDescription className="text-center">This will permanently delete this item from your inventory.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="sm:justify-center gap-2 mt-4">
                                    <AlertDialogCancel className="rounded-xl px-6">Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => onDelete(item)} className="rounded-xl px-6 bg-red-600 hover:bg-red-700 shadow-md">Delete Item</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>

                {/* Product Visual + Identity */}
                <div className="flex items-start gap-3.5 mb-3.5">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-50 via-violet-50/70 to-fuchsia-50 border border-purple-100/80 flex items-center justify-center shrink-0 overflow-hidden shadow-inner group-hover:scale-105 transition-transform">
                        {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : (
                            <CategoryIcon className="w-6 h-6 text-purple-600" />
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <h4 className="font-extrabold text-slate-900 text-sm leading-snug truncate" title={item.name}>
                            <HighlightedText text={item.name} highlight={highlightSearch} />
                        </h4>
                        <p className="text-xs font-medium text-slate-500 truncate mt-0.5">
                            {[
                                item.dosage,
                                item.specification,
                                item.subCategory || item.type,
                                item.usedForAge ? `Age: ${item.usedForAge}` : null
                            ].filter(Boolean).join(" • ") || "Standard Clinical Asset"}
                        </p>
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-100/80 capitalize">
                                {item.category.replace('_', ' ')}
                            </span>
                            {item.isSterile && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                                    Sterile
                                </span>
                            )}
                            {item.storageTemp && item.category === 'vaccinations' && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 truncate max-w-[130px]">
                                    {item.storageTemp}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Stock Capacity Progress Bar */}
                <div className="bg-slate-50/80 rounded-xl p-2.5 border border-slate-100 mb-3">
                    <div className="flex items-baseline justify-between mb-1.5">
                        <div>
                            <span className={cn("text-lg font-black tracking-tight", health.isBackorder || health.isZero ? "text-red-600" : health.isLowStock ? "text-amber-700" : "text-slate-900")}>
                                <AnimatedNumber value={Math.max(0, item.currentStock)} />
                            </span>
                            <span className="text-[11px] font-bold text-slate-500 ml-1">
                                {item.dispenseUnit ? `${item.dispenseUnit}s` : 'units'}
                            </span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400">
                            {health.capacityPercentage}% capacity (Min: {item.minStockThreshold || 10})
                        </span>
                    </div>
                    <div className="w-full h-2 bg-slate-200/70 rounded-full overflow-hidden">
                        <div
                            className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", barColor)}
                            style={{ width: `${Math.max(6, health.capacityPercentage)}%` }}
                        />
                    </div>
                </div>

                {/* Metadata Grid (Price, Supplier, Batch/Expiry, Location) */}
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 mb-3.5 px-0.5">
                    <div className="flex flex-col">
                        <span className="text-[9px] uppercase font-bold text-slate-400">Unit Price</span>
                        <span className="font-extrabold text-purple-950 text-xs">₹{item.price.toLocaleString()}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[9px] uppercase font-bold text-slate-400">Dispensed</span>
                        <span className="font-bold text-slate-700">{item.dispensed} units</span>
                    </div>
                    {item.supplier && (
                        <div className="flex items-center gap-1 col-span-2 truncate text-slate-500">
                            <Building2 className="w-3 h-3 text-purple-400 shrink-0" />
                            <span className="truncate">Supplier: <strong className="text-slate-700">{item.supplier}</strong></span>
                        </div>
                    )}
                    {item.location && (
                        <div className="flex items-center gap-1 col-span-2 truncate text-slate-500">
                            <MapPin className="w-3 h-3 text-purple-400 shrink-0" />
                            <span className="truncate">{item.location}</span>
                        </div>
                    )}
                    {item.hasExpiry !== false && (item.expiryDate || item.batchNumber) && (
                        <div className="flex items-center justify-between col-span-2 pt-1 border-t border-slate-100 text-[10px]">
                            {item.batchNumber ? <span className="font-mono font-bold text-slate-600">Batch: {item.batchNumber}</span> : <span />}
                            {item.expiryDate && (
                                <span className={cn("font-bold px-1.5 py-0.5 rounded", health.isExpired ? "bg-red-600 text-white" : health.isExpiringSoon ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-600")}>
                                    Exp: {item.expiryDate}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Card Footer Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-purple-50">
                {!health.isExpired ? (
                    <RefillStockDialog item={item} triggerVariant="card" onRefillSuccess={onMutated} />
                ) : (
                    <div className="flex-1 text-center py-2 rounded-xl bg-red-50 text-red-700 font-bold text-xs border border-red-200">
                        Expired — Dispose Stock
                    </div>
                )}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(item)}
                    className="h-9 px-3.5 rounded-xl border-purple-200 text-purple-700 hover:bg-purple-50 font-bold text-xs"
                >
                    <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Edit
                </Button>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
   Main Inventory Manager UI (Panacea Inventory 2.0)
   ───────────────────────────────────────────────────────────── */
export function InventoryManager() {
    const { user, firestore } = useFirebase();
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState("medications");
    const [addModalOpen, setAddModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState < CloudInventoryItem | null > (null);
    const [localSearch, setLocalSearch] = useState("");
    const [showDropdown, setShowDropdown] = useState(false);

    // Panacea 2.0 Explorer Controls
    const [viewMode, setViewMode] = useState < "table" | "card" > ("table");
    const [statusFilter, setStatusFilter] = useState < "all" | "low" | "expiring" | "expired" | "healthy" > ("all");
    const [supplierFilter, setSupplierFilter] = useState < string > ("all");
    const [sortBy, setSortBy] = useState < "name_asc" | "stock_asc" | "stock_desc" | "price_desc" | "dispensed_desc" > ("name_asc");
    const [recentlyUpdatedId, setRecentlyUpdatedId] = useState < string | null > (null);

    const triggerHighlight = (id: string) => {
        setRecentlyUpdatedId(id);
        setTimeout(() => {
            setRecentlyUpdatedId(prev => (prev === id ? null : prev));
        }, 2200);
    };

    // Preserve Custom Window Tab Switch Listener
    useEffect(() => {
        const handleSwitchTab = (e: any) => {
            if (e.detail) {
                setActiveTab(e.detail);
                setLocalSearch("");
                setStatusFilter("all");
                setSupplierFilter("all");
            }
        };
        window.addEventListener("switch-inventory-tab", handleSwitchTab);
        return () => window.removeEventListener("switch-inventory-tab", handleSwitchTab);
    }, []);

    const [isProcessing, setIsProcessing] = useState(false);
    const [processTitle, setProcessTitle] = useState("");
    const [processSubtitle, setProcessSubtitle] = useState("");
    const [processProgress, setProcessProgress] = useState(0);

    const fileInputRef = useRef < HTMLInputElement > (null);
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 40;
    const [downloadOpen, setDownloadOpen] = useState(false);
    const [reportRange, setReportRange] = useState("1month");
    const [isDownloading, setIsDownloading] = useState(false);

    // Logs Pagination State
    const [logsPage, setLogsPage] = useState(1);
    const LOGS_PER_PAGE = 40;

    const { items, loading } = useCloudInventory(activeTab !== 'log' ? activeTab : '');
    const logs = useCloudInventoryLogs(activeTab === 'log');

    useEffect(() => {
        setCurrentPage(1);
        setLogsPage(1);
    }, [localSearch, activeTab, statusFilter, supplierFilter, sortBy]);

    // Filter logs by search term BEFORE paginating
    const filteredLogs = useMemo(() => {
        if (!localSearch.trim()) return logs;
        const term = localSearch.toLowerCase();
        return logs.filter(log =>
            log.itemName.toLowerCase().includes(term) ||
            (log.patientName && log.patientName.toLowerCase().includes(term)) ||
            (log.notes && log.notes.toLowerCase().includes(term))
        );
    }, [logs, localSearch]);

    const paginatedLogs = useMemo(() => {
        const start = (logsPage - 1) * LOGS_PER_PAGE;
        return filteredLogs.slice(start, start + LOGS_PER_PAGE);
    }, [filteredLogs, logsPage]);

    const topUsed = useMemo(() => [...items].sort((a, b) => b.dispensed - a.dispensed).slice(0, 10).filter(i => i.dispensed > 0), [items]);
    const maxDispensed = topUsed.length > 0 ? topUsed[0].dispensed : 1;

    // Real-Time Derived Intelligence Metrics
    const inventoryMetrics = useMemo(() => {
        let totalValue = 0;
        let totalUnits = 0;
        let lowStockCount = 0;
        let criticalCount = 0;
        let expiringSoonCount = 0;
        let expiredCount = 0;
        let healthyCount = 0;

        items.forEach(item => {
            const avail = Math.max(0, item.currentStock);
            totalUnits += avail;
            totalValue += avail * (item.price || 0);

            const h = evaluateItemHealth(item);
            if (h.isExpired) expiredCount++;
            else if (h.isExpiringSoon) expiringSoonCount++;

            if (h.isBackorder || h.isZero) criticalCount++;
            else if (h.isLowStock) lowStockCount++;

            if (h.state === 'healthy') healthyCount++;
        });

        const total = items.length || 1;
        return {
            totalItems: items.length,
            totalValue,
            totalUnits,
            lowAndCriticalCount: lowStockCount + criticalCount,
            lowStockCount,
            criticalCount,
            expiringAttentionCount: expiringSoonCount + expiredCount,
            expiringSoonCount,
            expiredCount,
            healthyCount,
            healthyPct: items.length > 0 ? Math.round((healthyCount / total) * 100) : 100,
            lowPct: items.length > 0 ? Math.round(((lowStockCount + criticalCount) / total) * 100) : 0,
            expPct: items.length > 0 ? Math.round(((expiringSoonCount + expiredCount) / total) * 100) : 0,
        };
    }, [items]);

    // Unique Suppliers in current category for filter dropdown
    const availableSuppliers = useMemo(() => {
        const set = new Set < string > ();
        items.forEach(i => {
            if (i.supplier && i.supplier.trim()) set.add(i.supplier.trim());
        });
        return Array.from(set).sort();
    }, [items]);

    // Filtered & Sorted Category Items
    const categoryItems = useMemo(() => {
        const term = localSearch.trim().toLowerCase();
        const filtered = items.filter(d => {
            const matchesSearch = !term ||
                d.name.toLowerCase().includes(term) ||
                (d.supplier && d.supplier.toLowerCase().includes(term)) ||
                (d.batchNumber && d.batchNumber.toLowerCase().includes(term)) ||
                (d.location && d.location.toLowerCase().includes(term)) ||
                (d.subCategory && d.subCategory.toLowerCase().includes(term));

            if (!matchesSearch) return false;

            if (supplierFilter !== "all" && (d.supplier || "") !== supplierFilter) {
                return false;
            }

            if (statusFilter !== "all") {
                const h = evaluateItemHealth(d);
                if (statusFilter === "low" && !(h.isLowStock || h.isBackorder || h.isZero)) return false;
                if (statusFilter === "expiring" && !(h.isExpiringSoon || h.isExpired)) return false;
                if (statusFilter === "expired" && !h.isExpired) return false;
                if (statusFilter === "healthy" && h.state !== "healthy") return false;
            }

            return true;
        });

        return filtered.sort((a, b) => {
            if (sortBy === "stock_asc") return a.currentStock - b.currentStock;
            if (sortBy === "stock_desc") return b.currentStock - a.currentStock;
            if (sortBy === "price_desc") return (b.price || 0) - (a.price || 0);
            if (sortBy === "dispensed_desc") return (b.dispensed || 0) - (a.dispensed || 0);
            return a.name.localeCompare(b.name);
        });
    }, [items, localSearch, supplierFilter, statusFilter, sortBy]);

    const dynamicColumns = useMemo(() => Array.from(new Set(items.flatMap(i => Object.keys(i.customFields || {})))), [items]);

    const paginatedItems = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return categoryItems.slice(start, start + ITEMS_PER_PAGE);
    }, [categoryItems, currentPage]);

    const totalPages = Math.max(1, Math.ceil(categoryItems.length / ITEMS_PER_PAGE));

    // Inline Editing Save
    const handleInlineSave = async (item: CloudInventoryItem, field: string, val: any) => {
        if (!user || !firestore) return;
        try {
            let updateVal: any = val;
            if (field === 'price') updateVal = Math.max(0, parseFloat(val) || 0);
            if (field === 'initialStock') updateVal = parseInt(val, 10) || 0;
            if (field === 'minStockThreshold') updateVal = parseInt(val, 10) || 10;

            await updateDoc(doc(firestore, "doctors", user.uid, "inventory_management_stocks", item.id), { [field]: updateVal });
            triggerHighlight(item.id);
        } catch (e) {
            toast({ variant: 'destructive', description: 'Failed to update field.' });
        }
    };

    const handleInlineCustomFieldSave = async (item: CloudInventoryItem, col: string, val: string) => {
        if (!user || !firestore) return;
        try {
            await updateDoc(doc(firestore, "doctors", user.uid, "inventory_management_stocks", item.id), { [`customFields.${col}`]: val });
            triggerHighlight(item.id);
        } catch (e) {
            toast({ variant: 'destructive', description: 'Failed to update custom field.' });
        }
    };

    const handleDeleteColumn = async (colName: string) => {
        if (!user || !firestore) return;
        if (!confirm(`Delete column "${colName}" from all items in this category? This cannot be undone.`)) return;

        setIsProcessing(true);
        setProcessTitle("Deleting Column...");
        setProcessSubtitle(`Removing "${colName}" from all records.`);
        setProcessProgress(10);

        try {
            const BATCH_SIZE = 400;
            const batches = [];
            let currentBatch = writeBatch(firestore);
            let count = 0;

            categoryItems.forEach(item => {
                if (item.customFields && item.customFields[colName] !== undefined) {
                    currentBatch.update(doc(firestore, "doctors", user.uid, "inventory_management_stocks", item.id), {
                        [`customFields.${colName}`]: deleteField()
                    });
                    count++;
                    if (count === BATCH_SIZE) {
                        batches.push(currentBatch);
                        currentBatch = writeBatch(firestore);
                        count = 0;
                    }
                }
            });
            if (count > 0) batches.push(currentBatch);

            for (let i = 0; i < batches.length; i++) {
                await batches[i].commit();
                setProcessProgress(Math.round(((i + 1) / batches.length) * 100));
            }
            toast({ title: "Column Deleted", description: `Removed "${colName}".` });
        } catch (e) {
            toast({ variant: 'destructive', title: "Error", description: "Failed to delete column." });
        } finally {
            setIsProcessing(false);
        }
    };

    // Universal Excel/CSV Smart Upload
    const handleUniversalDataUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0 || !firestore || !user) return;
        const file = e.target.files[0];

        setIsProcessing(true);
        setProcessTitle("Parsing Data...");
        setProcessSubtitle("Analyzing and mapping columns smartly.");
        setProcessProgress(5);

        try {
            const XLSX = await import("xlsx");
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: "array" });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const parsedData: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            if (parsedData.length === 0) throw new Error("File is empty.");

            await new Promise(r => setTimeout(r, 50));
            setProcessProgress(20);
            setProcessTitle("Uploading Records...");
            setProcessSubtitle("Saving items to database in batches.");

            const BATCH_SIZE = 400;
            const batches = [];
            let currentBatch = writeBatch(firestore);
            let count = 0;

            parsedData.forEach(row => {
                const itemId = uuidv4();
                const docRef = doc(collection(firestore, "doctors", user.uid, "inventory_management_stocks"), itemId);
                const customFields: Record<string, string> = {};
                const normalizedObj: any = {
                    isEncryptedV1: false, category: activeTab, createdAt: serverTimestamp(), dispensed: 0,
                    department: activeTab === "blood_tests" ? "Laboratory" : activeTab === "consumables" ? "Consumables" : "Clinical"
                };

                Object.entries(row).forEach(([key, val]) => {
                    const cleanKey = key.trim().toLowerCase();
                    const cleanVal = typeof val === 'string' ? val.trim() : val;
                    if (cleanVal === "") return;

                    if (['name', 'item', 'product', 'description', 'title'].some(h => cleanKey === h || cleanKey.includes('name'))) normalizedObj.name = String(cleanVal);
                    else if (['dosage', 'dose', 'strength'].some(h => cleanKey.includes(h))) normalizedObj.dosage = String(cleanVal);
                    else if (cleanKey === 'type') normalizedObj.type = String(cleanVal);
                    else if (['price', 'cost', 'mrp', 'rate', 'amount'].some(h => cleanKey.includes(h))) normalizedObj.price = Math.max(0, parseFloat(String(cleanVal)) || 0);
                    else if (['stock', 'qty', 'quantity', 'balance', 'initial'].some(h => cleanKey.includes(h))) normalizedObj.initialStock = parseInt(String(cleanVal), 10) || 0;
                    else if (['age', 'used for'].some(h => cleanKey.includes(h))) normalizedObj.usedForAge = String(cleanVal);
                    else if (['desc', 'note'].some(h => cleanKey.includes(h))) normalizedObj.description = String(cleanVal);
                    else if (['batch', 'lot'].some(h => cleanKey.includes(h))) normalizedObj.batchNumber = String(cleanVal);
                    else if (['exp', 'expiry', 'valid'].some(h => cleanKey.includes(h))) normalizedObj.expiryDate = String(cleanVal);
                    else if (cleanKey.includes('location')) normalizedObj.location = String(cleanVal);
                    else if (cleanKey.includes('supplier') || cleanKey.includes('vendor')) normalizedObj.supplier = String(cleanVal);
                    else if (cleanKey.includes('min') || cleanKey.includes('threshold') || cleanKey.includes('alert')) normalizedObj.minStockThreshold = parseInt(String(cleanVal), 10) || 10;
                    else if (cleanKey.includes('conversion') || cleanKey.includes('per')) normalizedObj.conversionFactor = parseInt(String(cleanVal), 10) || 1;
                    else if (cleanKey.includes('subcat') || cleanKey.includes('category')) normalizedObj.subCategory = String(cleanVal);
                    else if (cleanKey.includes('purchase unit')) normalizedObj.purchaseUnit = String(cleanVal);
                    else if (cleanKey.includes('dispense unit')) normalizedObj.dispenseUnit = String(cleanVal);
                    else if (cleanKey.includes('spec') || cleanKey.includes('variant') || cleanKey.includes('size')) normalizedObj.specification = String(cleanVal);
                    else {
                        customFields[key.trim()] = String(cleanVal);
                    }
                });

                if (!normalizedObj.name) normalizedObj.name = "Imported Item";
                if (!normalizedObj.initialStock) normalizedObj.initialStock = 0;
                normalizedObj.customFields = customFields;

                currentBatch.set(docRef, normalizedObj);
                const logRef = doc(collection(firestore, "doctors", user.uid, "inventory_management_logs"), uuidv4());
                currentBatch.set(logRef, { isEncryptedV1: false, itemId, itemName: normalizedObj.name, actionType: 'refill', quantity: normalizedObj.initialStock, notes: "Excel Bulk Import", date: serverTimestamp() });

                count++;
                if (count === BATCH_SIZE) {
                    batches.push(currentBatch);
                    currentBatch = writeBatch(firestore);
                    count = 0;
                }
            });
            if (count > 0) batches.push(currentBatch);

            for (let i = 0; i < batches.length; i++) {
                await batches[i].commit();
                setProcessProgress(Math.round(((i + 1) / batches.length) * 100));
            }

            toast({ title: "Import Complete", description: `Successfully imported ${parsedData.length} items. Custom columns auto-generated.` });
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (err: any) {
            toast({ variant: "destructive", title: "Import Failed", description: err.message || "Failed to process file." });
        } finally {
            setIsProcessing(false);
        }
    };

    // Wipe Entire Category
    const handleWipeCategory = async () => {
        if (!user || !firestore || activeTab === 'log') return;

        setIsProcessing(true);
        setProcessTitle("Wiping Data...");
        setProcessSubtitle(`Fetching and permanently deleting all ${activeTab.replace('_', ' ')} records. Please wait...`);
        setProcessProgress(5);

        try {
            const fullQuery = query(
                collection(firestore, "doctors", user.uid, "inventory_management_stocks"),
                where("category", "==", activeTab)
            );
            const snapshot = await getDocs(fullQuery);

            if (snapshot.empty) {
                toast({ description: "No records to delete in this category." });
                setIsProcessing(false);
                return;
            }

            const BATCH_SIZE = 400;
            const batches = [];
            let currentBatch = writeBatch(firestore);
            let count = 0;

            snapshot.docs.forEach(document => {
                currentBatch.delete(document.ref);
                count++;

                if (count === BATCH_SIZE) {
                    batches.push(currentBatch);
                    currentBatch = writeBatch(firestore);
                    count = 0;
                }
            });
            if (count > 0) batches.push(currentBatch);

            for (let i = 0; i < batches.length; i++) {
                await batches[i].commit();
                setProcessProgress(Math.round(((i + 1) / batches.length) * 100));
            }

            toast({ title: "Category Wiped", description: `Successfully deleted ${snapshot.size} records from ${activeTab.replace('_', ' ')}.` });
        } catch (err: any) {
            toast({ variant: "destructive", title: "Wipe Failed", description: "Could not wipe the collection." });
        } finally {
            setIsProcessing(false);
            setProcessProgress(0);
        }
    };

    const handleDeleteStock = async (item: CloudInventoryItem) => {
        if (!user || !firestore) return;
        try {
            await deleteDoc(doc(firestore, "doctors", user.uid, "inventory_management_stocks", item.id));
            toast({ title: "Item Deleted", description: `${item.name} has been removed.` });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error' });
        }
    };

    const handleDownloadPdf = async () => {
        if (!user || !firestore) return;
        setIsDownloading(true);
        try {
            const now = new Date();
            let startDate = new Date(0);
            let rangeText = "All Time";
            if (reportRange === '1month') { startDate = subMonths(now, 1); rangeText = "Last 1 Month"; }
            if (reportRange === '6months') { startDate = subMonths(now, 6); rangeText = "Last 6 Months"; }
            if (reportRange === '1year') { startDate = subMonths(now, 12); rangeText = "Last 1 Year"; }

            let logsQ = reportRange === 'all' ? query(collection(firestore, "doctors", user.uid, "inventory_management_logs")) : query(collection(firestore, "doctors", user.uid, "inventory_management_logs"), where("date", ">=", startDate));
            const logsSnap = await getDocs(logsQ);
            const reportLogs = logsSnap.docs.map(document => {
                const data = document.data();
                return {
                    itemName: safeDecrypt(data.itemName), patientName: safeDecrypt(data.patientName),
                    actionType: data.actionType, quantity: data.quantity, notes: safeDecrypt(data.notes), date: data.date?.toDate() || new Date(),
                };
            }).sort((a, b) => b.date.getTime() - a.date.getTime());

            const docPdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = docPdf.internal.pageSize.getWidth();
            let currentY = 20;

            docPdf.setFillColor(124, 58, 237);
            docPdf.rect(0, 0, pdfWidth, 35, 'F');
            docPdf.setTextColor(255, 255, 255);
            docPdf.setFontSize(22);
            docPdf.setFont('helvetica', 'bold');
            docPdf.text("CLINIC INVENTORY REPORT", pdfWidth / 2, 22, { align: 'center' });

            currentY = 45;
            docPdf.setTextColor(0, 0, 0);
            docPdf.setFontSize(10);
            docPdf.setFont('helvetica', 'normal');
            docPdf.text(`Generated On: ${format(new Date(), 'PPP p')}`, 15, currentY);
            docPdf.text(`Report Period: ${rangeText}`, pdfWidth - 15, currentY, { align: 'right' });
            currentY += 12;

            docPdf.setFontSize(14);
            docPdf.setFont('helvetica', 'bold');
            docPdf.setTextColor(109, 40, 217);
            docPdf.text("Current Stock Levels", 15, currentY);
            currentY += 6;

            autoTable(docPdf, {
                startY: currentY,
                head: [['Item Name', 'Category', 'Price', 'Initial', 'Dispensed', 'Current']],
                body: items.map(item => [item.name, item.category.toUpperCase(), `Rs. ${item.price}`, item.initialStock, item.dispensed, item.currentStock]),
                theme: 'grid',
                headStyles: { fillColor: [139, 92, 246], textColor: 255 },
                styles: { fontSize: 9, cellPadding: 3 },
            });

            currentY = (docPdf as any).lastAutoTable.finalY + 15;
            docPdf.text(`Usage Logs (${rangeText})`, 15, currentY);
            currentY += 6;

            autoTable(docPdf, {
                startY: currentY,
                head: [['Date', 'Action', 'Item', 'Patient / Notes', 'Qty']],
                body: reportLogs.map((log: any) => [format(log.date, 'MMM d, yyyy h:mm a'), log.actionType.toUpperCase(), log.itemName, `${log.patientName || ''} ${log.notes ? `(${log.notes})` : ''}`.trim(), `${log.actionType === 'refill' ? '+' : '-'}${log.quantity}`]),
                theme: 'striped',
                headStyles: { fillColor: [167, 139, 250], textColor: 255 },
                styles: { fontSize: 8 },
            });

            docPdf.save(`Inventory_Report_${format(new Date(), 'yyyy_MM_dd')}.pdf`);
            setDownloadOpen(false);
        } catch (error) {
            toast({ variant: 'destructive', title: "Download Failed" });
        } finally {
            setIsDownloading(false);
        }
    };

    const categoryLabel =
        activeTab === 'medications' ? 'Medications' :
            activeTab === 'vaccinations' ? 'Vaccinations' :
                activeTab === 'blood_tests' ? 'Lab Equipment' :
                    activeTab === 'consumables' ? 'Consumables' : 'Activity Logs';

    return (
        <Card className="shadow-2xl shadow-purple-950/5 border border-purple-100/80 overflow-hidden rounded-3xl bg-white/85 backdrop-blur-xl relative animate-in fade-in duration-500">

            {/* FULL SCREEN PROGRESS OVERLAY FOR EXCEL PARSING & BULK OPS */}
            {isProcessing && (
                <div className="fixed inset-0 bg-white/80 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-4">
                    <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full text-center border border-purple-100 animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 rounded-2xl bg-purple-50 border border-purple-100 flex items-center justify-center mx-auto mb-4">
                            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                        </div>
                        <h3 className="text-xl font-black text-purple-950 mb-1.5">{processTitle}</h3>
                        <p className="text-xs font-medium text-slate-500 mb-6">{processSubtitle}</p>
                        <div className="w-full bg-purple-50 rounded-full h-3 mb-2 overflow-hidden border border-purple-100">
                            <div className="bg-gradient-to-r from-fuchsia-500 via-purple-600 to-violet-600 h-full rounded-full transition-all duration-300" style={{ width: `${processProgress}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] font-bold text-purple-700">
                            <span>Cloud Batch Sync</span>
                            <span>{processProgress}%</span>
                        </div>
                    </div>
                </div>
            )}

            <input type="file" accept=".csv, .xlsx, .xls" ref={fileInputRef} className="hidden" onChange={handleUniversalDataUpload} />

            {/* Top Signature Accent Bar */}
            <div className="h-1.5 w-full bg-gradient-to-r from-fuchsia-500 via-purple-600 to-violet-600" />

            {/* ─────────────────────────────────────────────────────────
               A. SPECTACULAR INVENTORY HEADER & INTELLIGENCE RIBBON
               ───────────────────────────────────────────────────────── */}
            <CardHeader className="bg-gradient-to-b from-purple-50/50 via-white to-white border-b border-purple-100/70 pb-6 pt-6 px-5 sm:px-8 relative overflow-hidden">
                {/* Ambient Decorative Glows */}
                <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-purple-200/25 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 left-1/3 w-64 h-64 rounded-full bg-fuchsia-200/20 blur-3xl pointer-events-none" />

                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5 relative z-10">
                    <div className="flex items-start sm:items-center gap-4">
                        <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-purple-600 via-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-500/25 text-white shrink-0">
                            <Archive className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2.5">
                                <span className="text-[10px] font-black uppercase tracking-widest text-purple-700 bg-purple-100/90 border border-purple-200/60 px-2.5 py-0.5 rounded-full">
                                    Panacea Inventory 2.0
                                </span>
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-0.5 rounded-full">
                                    <span className={cn("w-2 h-2 rounded-full", loading ? "bg-amber-400 animate-ping" : "bg-emerald-500 animate-pulse")} />
                                    {loading ? "Syncing Cloud..." : "Live Cloud Sync"}
                                </span>
                            </div>
                            <CardTitle className="text-2xl sm:text-3xl font-black text-purple-950 tracking-tight mt-1">
                                Your Clinic&apos;s Inventory, <span className="bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">Smarter Than Ever</span>
                            </CardTitle>
                            <CardDescription className="text-slate-500 font-medium text-xs sm:text-sm mt-1">
                                Track, manage, and monitor real-time clinical stock, cold-chain vaccines, and supply health in one command center.
                            </CardDescription>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 w-full lg:w-auto justify-between lg:justify-end">
                        <HeroMedicalIllustration />
                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full sm:w-auto">
                            {activeTab !== 'log' && (
                                <Button
                                    variant="outline"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="rounded-xl h-11 px-4 border-purple-200 text-purple-800 bg-white hover:bg-purple-50 hover:border-purple-300 font-bold text-xs shadow-2xs transition-all active:scale-95 flex-1 sm:flex-initial"
                                >
                                    <Upload className="w-4 h-4 mr-2 text-purple-600" /> Smart Import
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                onClick={() => setDownloadOpen(true)}
                                className="rounded-xl h-11 px-4 border-purple-200 text-purple-800 bg-white hover:bg-purple-50 hover:border-purple-300 font-bold text-xs shadow-2xs transition-all active:scale-95 flex-1 sm:flex-initial"
                            >
                                <Download className="w-4 h-4 mr-2 text-purple-600" /> Report
                            </Button>
                            <Button
                                onClick={() => { setEditingItem(null); setAddModalOpen(true); }}
                                className="rounded-xl h-11 px-5 bg-gradient-to-r from-purple-600 via-violet-600 to-fuchsia-600 hover:from-purple-700 hover:via-violet-700 hover:to-fuchsia-700 text-white font-bold text-xs shadow-lg shadow-purple-500/25 transition-all hover:shadow-xl hover:-translate-y-0.5 active:scale-95 w-full sm:w-auto"
                            >
                                <PlusCircle className="w-4 h-4 mr-2" /> Add New Item
                            </Button>
                        </div>
                    </div>
                </div>

                {/* ─────────────────────────────────────────────────────────
                   B. INTERACTIVE INVENTORY INTELLIGENCE CARDS
                   ───────────────────────────────────────────────────────── */}
                {activeTab !== 'log' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 mt-6 relative z-10">
                        {/* Card 1: Total Items & Units */}
                        <button
                            type="button"
                            onClick={() => setStatusFilter("all")}
                            className={cn(
                                "text-left p-4 rounded-2xl bg-white border transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 flex items-center justify-between group",
                                statusFilter === "all" ? "border-purple-400 ring-2 ring-purple-500/15 bg-purple-50/20" : "border-purple-100 hover:border-purple-300"
                            )}
                        >
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total {categoryLabel}</span>
                                    {statusFilter === "all" && <span className="text-[9px] font-extrabold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">Active View</span>}
                                </div>
                                <div className="text-2xl sm:text-3xl font-black text-purple-950 mt-1">
                                    <AnimatedNumber value={inventoryMetrics.totalItems} />
                                </div>
                                <p className="text-[11px] font-semibold text-purple-600/80 mt-1 flex items-center gap-1">
                                    <PackageCheck className="w-3.5 h-3.5" />
                                    <span><AnimatedNumber value={inventoryMetrics.totalUnits} /> total available units</span>
                                </p>
                            </div>
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-100 to-violet-50 border border-purple-200/60 flex items-center justify-center text-purple-600 group-hover:scale-110 transition-transform">
                                <Archive className="w-5 h-5" />
                            </div>
                        </button>

                        {/* Card 2: Stock Capital Value */}
                        <div className="p-4 rounded-2xl bg-white border border-purple-100 transition-all duration-300 hover:shadow-md hover:border-purple-300 flex items-center justify-between group">
                            <div>
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Category Stock Value</span>
                                <div className="text-2xl sm:text-3xl font-black text-purple-950 mt-1">
                                    <AnimatedNumber value={Math.round(inventoryMetrics.totalValue)} prefix="₹" />
                                </div>
                                <p className="text-[11px] font-semibold text-emerald-600 mt-1 flex items-center gap-1">
                                    <Activity className="w-3.5 h-3.5" />
                                    <span>{inventoryMetrics.healthyPct}% stock in healthy range</span>
                                </p>
                            </div>
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-100 to-purple-50 border border-fuchsia-200/60 flex items-center justify-center text-fuchsia-600 group-hover:scale-110 transition-transform">
                                <CircleDollarSign className="w-5 h-5" />
                            </div>
                        </div>

                        {/* Card 3: Low Stock / Critical Alert (Interactive Filter) */}
                        <button
                            type="button"
                            onClick={() => setStatusFilter(prev => prev === "low" ? "all" : "low")}
                            className={cn(
                                "text-left p-4 rounded-2xl bg-white border transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 flex items-center justify-between group",
                                statusFilter === "low" ? "border-amber-400 ring-2 ring-amber-500/20 bg-amber-50/30" : "border-purple-100 hover:border-amber-300"
                            )}
                        >
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Low / Depleted Stock</span>
                                    {statusFilter === "low" && <span className="text-[9px] font-extrabold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Filtered</span>}
                                </div>
                                <div className={cn("text-2xl sm:text-3xl font-black mt-1", inventoryMetrics.lowAndCriticalCount > 0 ? "text-amber-600" : "text-slate-900")}>
                                    <AnimatedNumber value={inventoryMetrics.lowAndCriticalCount} />
                                </div>
                                <p className="text-[11px] font-semibold text-slate-500 mt-1">
                                    {inventoryMetrics.criticalCount > 0 ? (
                                        <span className="text-red-600 font-bold">{inventoryMetrics.criticalCount} critical/backorder • Click to filter</span>
                                    ) : inventoryMetrics.lowStockCount > 0 ? (
                                        <span className="text-amber-700">Below threshold • Click to filter</span>
                                    ) : (
                                        <span className="text-emerald-600">All items above minimum alert</span>
                                    )}
                                </p>
                            </div>
                            <div className={cn(
                                "w-12 h-12 rounded-2xl border flex items-center justify-center group-hover:scale-110 transition-transform",
                                inventoryMetrics.lowAndCriticalCount > 0 ? "bg-amber-50 border-amber-200 text-amber-600" : "bg-slate-50 border-slate-200 text-slate-400"
                            )}>
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                        </button>

                        {/* Card 4: Near Expiry / Expired Alert (Interactive Filter) */}
                        <button
                            type="button"
                            onClick={() => setStatusFilter(prev => prev === "expiring" ? "all" : "expiring")}
                            className={cn(
                                "text-left p-4 rounded-2xl bg-white border transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 flex items-center justify-between group",
                                statusFilter === "expiring" ? "border-red-400 ring-2 ring-red-500/20 bg-red-50/30" : "border-purple-100 hover:border-red-300"
                            )}
                        >
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Expiring / Expired</span>
                                    {statusFilter === "expiring" && <span className="text-[9px] font-extrabold bg-red-100 text-red-800 px-1.5 py-0.5 rounded">Filtered</span>}
                                </div>
                                <div className={cn("text-2xl sm:text-3xl font-black mt-1", inventoryMetrics.expiringAttentionCount > 0 ? "text-red-600" : "text-slate-900")}>
                                    <AnimatedNumber value={inventoryMetrics.expiringAttentionCount} />
                                </div>
                                <p className="text-[11px] font-semibold text-slate-500 mt-1">
                                    {inventoryMetrics.expiredCount > 0 ? (
                                        <span className="text-red-600 font-bold">{inventoryMetrics.expiredCount} expired • {inventoryMetrics.expiringSoonCount} within 30d</span>
                                    ) : inventoryMetrics.expiringSoonCount > 0 ? (
                                        <span className="text-orange-600 font-bold">{inventoryMetrics.expiringSoonCount} expiring within 30 days</span>
                                    ) : (
                                        <span className="text-emerald-600">No upcoming expiry risks</span>
                                    )}
                                </p>
                            </div>
                            <div className={cn(
                                "w-12 h-12 rounded-2xl border flex items-center justify-center group-hover:scale-110 transition-transform",
                                inventoryMetrics.expiringAttentionCount > 0 ? "bg-red-50 border-red-200 text-red-600" : "bg-slate-50 border-slate-200 text-slate-400"
                            )}>
                                <CalendarClock className="w-5 h-5" />
                            </div>
                        </button>
                    </div>
                )}

                {/* Proportional Stock Health Bar & Quick Alert Strip */}
                {activeTab !== 'log' && items.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-purple-100/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 relative z-10">
                        <div className="flex items-center gap-3 w-full sm:w-auto flex-1 max-w-md">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-purple-800 whitespace-nowrap">Inventory Health</span>
                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden flex p-0.5 gap-0.5 border border-purple-100">
                                {inventoryMetrics.healthyPct > 0 && (
                                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${inventoryMetrics.healthyPct}%` }} title={`Healthy: ${inventoryMetrics.healthyPct}%`} />
                                )}
                                {inventoryMetrics.lowPct > 0 && (
                                    <div className="h-full bg-amber-500 rounded-full transition-all duration-700" style={{ width: `${inventoryMetrics.lowPct}%` }} title={`Low/Critical: ${inventoryMetrics.lowPct}%`} />
                                )}
                                {inventoryMetrics.expPct > 0 && (
                                    <div className="h-full bg-red-500 rounded-full transition-all duration-700" style={{ width: `${inventoryMetrics.expPct}%` }} title={`Expiry Risk: ${inventoryMetrics.expPct}%`} />
                                )}
                            </div>
                            <span className="text-[11px] font-bold text-slate-600">{inventoryMetrics.healthyPct}% Healthy</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            {statusFilter !== "all" || supplierFilter !== "all" || localSearch.trim() !== "" ? (
                                <button
                                    type="button"
                                    onClick={() => { setStatusFilter("all"); setSupplierFilter("all"); setLocalSearch(""); }}
                                    className="inline-flex items-center gap-1 text-xs font-bold text-purple-700 bg-purple-100/80 hover:bg-purple-200/80 px-3 py-1 rounded-full transition-colors"
                                >
                                    <X className="w-3 h-3" /> Reset Active Filters ({categoryItems.length} of {items.length} shown)
                                </button>
                            ) : (
                                <span className="text-slate-400 font-medium text-xs">
                                    Tip: Click any metric card above to filter stock by health status, or click any table cell to inline edit.
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </CardHeader>

            {/* ─────────────────────────────────────────────────────────
               C. MAIN WORKSPACE & CATEGORY TABS
               ───────────────────────────────────────────────────────── */}
            <CardContent className="p-4 sm:p-6 bg-slate-50/40">
                <Tabs value={activeTab} onValueChange={(val) => { setActiveTab(val); setLocalSearch(""); setStatusFilter("all"); setSupplierFilter("all"); }}>

                    {/* Primary Category Navigation Pills */}
                    <TabsList className="flex flex-wrap w-full h-auto p-1.5 bg-white border border-purple-100 shadow-xs rounded-2xl gap-1.5">
                        <TabsTrigger value="medications" className="flex-1 min-w-[120px] py-2.5 px-3 text-xs sm:text-sm font-bold rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-violet-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-purple-500/20 text-slate-600 hover:text-purple-800 transition-all duration-300 flex items-center justify-center gap-2">
                            <Pill className="w-4 h-4" /> Medications
                        </TabsTrigger>
                        <TabsTrigger value="vaccinations" className="flex-1 min-w-[120px] py-2.5 px-3 text-xs sm:text-sm font-bold rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-violet-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-purple-500/20 text-slate-600 hover:text-purple-800 transition-all duration-300 flex items-center justify-center gap-2">
                            <Syringe className="w-4 h-4" /> Vaccinations
                        </TabsTrigger>
                        <TabsTrigger value="blood_tests" className="flex-1 min-w-[120px] py-2.5 px-3 text-xs sm:text-sm font-bold rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-violet-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-purple-500/20 text-slate-600 hover:text-purple-800 transition-all duration-300 flex items-center justify-center gap-2">
                            <TestTube className="w-4 h-4" /> Lab Equipment
                        </TabsTrigger>
                        <TabsTrigger value="consumables" className="flex-1 min-w-[120px] py-2.5 px-3 text-xs sm:text-sm font-bold rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-600 data-[state=active]:to-violet-600 data-[state=active]:text-white data-[state=active]:shadow-md data-[state=active]:shadow-purple-500/20 text-slate-600 hover:text-purple-800 transition-all duration-300 flex items-center justify-center gap-2">
                            <Box className="w-4 h-4" /> Consumables
                        </TabsTrigger>
                        <div className="w-[1px] bg-purple-100 my-1 hidden md:block" />
                        <TabsTrigger value="log" className="flex-1 min-w-[120px] py-2.5 px-3 text-xs sm:text-sm font-bold rounded-xl data-[state=active]:bg-purple-950 data-[state=active]:text-white data-[state=active]:shadow-md text-purple-900 hover:bg-purple-50 transition-all duration-300 flex items-center justify-center gap-2">
                            <History className="w-4 h-4" /> Activity Logs
                        </TabsTrigger>
                    </TabsList>

                    {["medications", "vaccinations", "blood_tests", "consumables"].map((category) => {
                        return (
                            <TabsContent key={category} value={category} className="mt-6 animate-in fade-in duration-300">
                                <Tabs defaultValue="list" className="w-full">

                                    {/* Explorer Toolbar: View Switch, Search, Filters, Sort, Wipe */}
                                    <div className="flex flex-col xl:flex-row justify-between items-stretch xl:items-center mb-5 gap-3 bg-white p-3 rounded-2xl border border-purple-100/80 shadow-2xs">

                                        {/* Left: Sub-Tabs (Stock List vs Analytics) & Dual View Mode Switch */}
                                        <div className="flex flex-wrap items-center gap-2">
                                            <TabsList className="bg-purple-50/70 border border-purple-100 rounded-xl p-1 h-auto">
                                                <TabsTrigger value="list" className="py-1.5 px-3.5 rounded-lg text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-purple-800 data-[state=active]:shadow-2xs transition-all">
                                                    <Archive className="w-3.5 h-3.5 mr-1.5" /> Inventory Explorer
                                                </TabsTrigger>
                                                <TabsTrigger value="stats" className="py-1.5 px-3.5 rounded-lg text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-fuchsia-700 data-[state=active]:shadow-2xs transition-all">
                                                    <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Usage & Analytics
                                                </TabsTrigger>
                                            </TabsList>

                                            {/* Card vs Table View Switch */}
                                            <div className="flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200/60">
                                                <button
                                                    type="button"
                                                    onClick={() => setViewMode("table")}
                                                    className={cn(
                                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                                                        viewMode === "table" ? "bg-purple-600 text-white shadow-xs" : "text-slate-600 hover:text-purple-700"
                                                    )}
                                                >
                                                    <List className="w-3.5 h-3.5" /> Table View
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setViewMode("card")}
                                                    className={cn(
                                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                                                        viewMode === "card" ? "bg-purple-600 text-white shadow-xs" : "text-slate-600 hover:text-purple-700"
                                                    )}
                                                >
                                                    <LayoutGrid className="w-3.5 h-3.5" /> Card View
                                                </button>
                                            </div>
                                        </div>

                                        {/* Right: Search, Status Filter, Supplier Filter, Sort & Wipe */}
                                        <div className="flex flex-wrap items-center gap-2 flex-1 xl:justify-end">

                                            {/* Search with Auto-Complete */}
                                            <div className="relative flex-1 min-w-[210px] sm:max-w-xs z-40">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-purple-400" />
                                                <Input
                                                    placeholder={`Search ${category.replace('_', ' ')}, batch, supplier...`}
                                                    value={localSearch}
                                                    onFocus={() => setShowDropdown(true)}
                                                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                                                    onChange={e => {
                                                        setLocalSearch(e.target.value);
                                                        setShowDropdown(true);
                                                        setCurrentPage(1);
                                                    }}
                                                    className="pl-9 pr-8 h-10 bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl focus-visible:ring-purple-500 text-xs font-medium shadow-2xs"
                                                />
                                                {localSearch && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setLocalSearch("")}
                                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}

                                                {/* Auto-Complete Dropdown */}
                                                {showDropdown && localSearch.trim() && categoryItems.length > 0 &&
                                                    !(categoryItems.length === 1 && categoryItems[0].name.toLowerCase() === localSearch.toLowerCase()) && (
                                                        <div className="absolute top-full left-0 mt-1.5 w-full sm:w-[360px] max-h-72 overflow-y-auto bg-white border border-purple-100 shadow-2xl rounded-2xl p-1.5 flex flex-col gap-1 z-[100]">
                                                            {Array.from(new Set(categoryItems.map(i => i.name))).slice(0, 8).map((uniqueItemName, idx) => (
                                                                <div
                                                                    key={idx}
                                                                    className="p-2.5 hover:bg-purple-50 rounded-xl cursor-pointer transition-colors flex justify-between items-center gap-3"
                                                                    onMouseDown={(e) => e.preventDefault()}
                                                                    onClick={() => {
                                                                        setLocalSearch(uniqueItemName);
                                                                        setShowDropdown(false);
                                                                        setCurrentPage(1);
                                                                    }}
                                                                >
                                                                    <p className="text-xs font-bold text-slate-800 truncate">
                                                                        <HighlightedText text={uniqueItemName} highlight={localSearch} />
                                                                    </p>
                                                                    <span className="text-[10px] text-purple-600 font-bold bg-purple-100/70 px-2 py-0.5 rounded-md shrink-0">
                                                                        Select
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                            </div>

                                            {/* Stock Status Filter */}
                                            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                                                <SelectTrigger className="h-10 w-[138px] text-xs font-semibold bg-slate-50/70 border-purple-100 rounded-xl">
                                                    <SelectValue placeholder="Stock Status" />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl border-purple-100">
                                                    <SelectItem value="all">All Statuses</SelectItem>
                                                    <SelectItem value="healthy">Healthy Stock</SelectItem>
                                                    <SelectItem value="low">Low / Critical</SelectItem>
                                                    <SelectItem value="expiring">Expiring / Expired</SelectItem>
                                                    <SelectItem value="expired">Expired Only</SelectItem>
                                                </SelectContent>
                                            </Select>

                                            {/* Supplier Filter (When suppliers exist) */}
                                            {availableSuppliers.length > 0 && (
                                                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                                                    <SelectTrigger className="h-10 w-[140px] text-xs font-semibold bg-slate-50/70 border-purple-100 rounded-xl">
                                                        <SelectValue placeholder="All Suppliers" />
                                                    </SelectTrigger>
                                                    <SelectContent className="rounded-xl border-purple-100">
                                                        <SelectItem value="all">All Suppliers</SelectItem>
                                                        {availableSuppliers.map(sup => (
                                                            <SelectItem key={sup} value={sup}>{sup}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}

                                            {/* Sort Order */}
                                            <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                                                <SelectTrigger className="h-10 w-[148px] text-xs font-semibold bg-slate-50/70 border-purple-100 rounded-xl">
                                                    <SelectValue placeholder="Sort By" />
                                                </SelectTrigger>
                                                <SelectContent className="rounded-xl border-purple-100">
                                                    <SelectItem value="name_asc">Name (A–Z)</SelectItem>
                                                    <SelectItem value="stock_asc">Stock (Low to High)</SelectItem>
                                                    <SelectItem value="stock_desc">Stock (High to Low)</SelectItem>
                                                    <SelectItem value="price_desc">Price (High to Low)</SelectItem>
                                                    <SelectItem value="dispensed_desc">Most Dispensed</SelectItem>
                                                </SelectContent>
                                            </Select>

                                            {/* Destructive Wipe Category Action (Protected by AlertDialog) */}
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="outline" size="icon" title={`Wipe all ${category.replace('_', ' ')}`} className="h-10 w-10 rounded-xl text-red-500 border-red-100 bg-red-50/40 hover:bg-red-100/70 hover:text-red-700 shrink-0" disabled={items.length === 0 || loading}>
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent className="rounded-3xl border-red-100 shadow-2xl max-w-sm">
                                                    <AlertDialogHeader>
                                                        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-2 mx-auto">
                                                            <AlertTriangle className="w-6 h-6 text-red-600" />
                                                        </div>
                                                        <AlertDialogTitle className="text-center text-red-600 text-xl">Wipe {category.replace('_', ' ')}?</AlertDialogTitle>
                                                        <AlertDialogDescription className="text-center">
                                                            This will permanently delete <strong>ALL {items.length} items</strong> in this category. You cannot undo this action.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter className="sm:justify-center gap-2 mt-4">
                                                        <AlertDialogCancel className="rounded-xl px-6">Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={handleWipeCategory} className="rounded-xl px-6 bg-red-600 hover:bg-red-700 shadow-md">Yes, Wipe Data</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </div>

                                    {/* ─── LIST / CARD VIEW TAB CONTENT ─── */}
                                    <TabsContent value="list" className="mt-0">
                                        {loading ? (
                                            /* Shimmering Skeleton Loader */
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                                {Array.from({ length: 8 }).map((_, idx) => (
                                                    <div key={idx} className="rounded-2xl bg-white border border-purple-100/60 p-4 space-y-3 animate-pulse">
                                                        <div className="flex justify-between">
                                                            <div className="h-5 w-20 bg-purple-100 rounded-full" />
                                                            <div className="h-5 w-12 bg-slate-100 rounded-md" />
                                                        </div>
                                                        <div className="flex gap-3 items-center">
                                                            <div className="w-12 h-12 rounded-2xl bg-purple-100/70" />
                                                            <div className="space-y-2 flex-1">
                                                                <div className="h-4 w-3/4 bg-slate-200 rounded" />
                                                                <div className="h-3 w-1/2 bg-slate-100 rounded" />
                                                            </div>
                                                        </div>
                                                        <div className="h-12 bg-slate-50 rounded-xl" />
                                                        <div className="h-8 bg-purple-100/50 rounded-xl" />
                                                    </div>
                                                ))}
                                            </div>
                                        ) : paginatedItems.length === 0 ? (
                                            /* Polished Empty State */
                                            <div className="rounded-3xl bg-white border border-purple-100/80 py-16 px-4 text-center shadow-2xs">
                                                <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-purple-100 to-fuchsia-50 border border-purple-200/60 flex items-center justify-center mx-auto mb-4 shadow-inner">
                                                    <Sparkles className="w-7 h-7 text-purple-600" />
                                                </div>
                                                <h4 className="text-lg font-extrabold text-purple-950">No matching inventory assets found</h4>
                                                <p className="text-xs font-medium text-slate-500 max-w-md mx-auto mt-1">
                                                    {localSearch || statusFilter !== "all" || supplierFilter !== "all"
                                                        ? "No items match your active search or filter criteria. Try clearing filters to view all items."
                                                        : `Your ${category.replace('_', ' ')} inventory is currently empty. Add your first item or import a spreadsheet.`}
                                                </p>
                                                <div className="flex items-center justify-center gap-2.5 mt-5">
                                                    {(localSearch || statusFilter !== "all" || supplierFilter !== "all") ? (
                                                        <Button variant="outline" onClick={() => { setLocalSearch(""); setStatusFilter("all"); setSupplierFilter("all"); }} className="rounded-xl border-purple-200 text-purple-700 font-bold text-xs">
                                                            Reset All Filters
                                                        </Button>
                                                    ) : (
                                                        <>
                                                            <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="rounded-xl border-purple-200 text-purple-700 font-bold text-xs">
                                                                <Upload className="w-3.5 h-3.5 mr-1.5" /> Import Excel/CSV
                                                            </Button>
                                                            <Button onClick={() => { setEditingItem(null); setAddModalOpen(true); }} className="rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs">
                                                                <PlusCircle className="w-3.5 h-3.5 mr-1.5" /> Add First Item
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ) : viewMode === "card" ? (
                                            /* ─── PREMIUM CARD GRID VIEW ─── */
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-in fade-in duration-300">
                                                {paginatedItems.map(item => (
                                                    <InventoryItemCard
                                                        key={item.id}
                                                        item={item}
                                                        highlightSearch={localSearch}
                                                        recentlyUpdated={recentlyUpdatedId === item.id}
                                                        onEdit={(it) => { setEditingItem(it); setAddModalOpen(true); }}
                                                        onDelete={handleDeleteStock}
                                                        onMutated={triggerHighlight}
                                                    />
                                                ))}
                                            </div>
                                        ) : (
                                            /* ─── INFORMATION-DENSE INLINE-EDITABLE TABLE VIEW ─── */
                                            <div className="border border-purple-100/80 rounded-2xl shadow-xs bg-white overflow-hidden transition-all duration-300">
                                                <div className="overflow-x-auto w-full">
                                                    <Table className="w-full">
                                                        <TableHeader className="bg-gradient-to-r from-purple-50/80 via-violet-50/50 to-purple-50/80 border-b border-purple-100">
                                                            <TableRow className="hover:bg-transparent">
                                                                <TableHead className="font-extrabold text-purple-950 text-xs h-12 pl-6 whitespace-nowrap min-w-[220px]">
                                                                    {category === 'vaccinations' ? 'Vaccine / Antigen' : category === 'blood_tests' ? 'Asset Name' : category === 'consumables' ? 'Consumable Name' : 'Item Name'}
                                                                </TableHead>

                                                                {category === 'medications' && (
                                                                    <>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Dosage</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Type</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Used For Age</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Supplier</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Description</TableHead>
                                                                    </>
                                                                )}

                                                                {category === 'vaccinations' && (
                                                                    <>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Brand / Mfg</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Patient Age</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Funding</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Pkg Type</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Storage Temp</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Reconstitution</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Location</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Tags</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Batch / Expiry</TableHead>
                                                                    </>
                                                                )}

                                                                {category === 'blood_tests' && (
                                                                    <>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Sub-Category</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Batch / Lot</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Arrival Date</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Expiry Date</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Location</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Tags</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Supplier</TableHead>
                                                                    </>
                                                                )}

                                                                {category === 'consumables' && (
                                                                    <>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Variant / Size</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Sub-Category</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Sterile</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Batch / Expiry</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Location</TableHead>
                                                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Supplier</TableHead>
                                                                    </>
                                                                )}

                                                                <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Min Alert</TableHead>
                                                                <TableHead className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap">Price (₹)</TableHead>

                                                                {/* Dynamic Smart Columns Header */}
                                                                {dynamicColumns.map(col => (
                                                                    <TableHead key={col} className="font-extrabold text-purple-950 text-xs h-12 whitespace-nowrap group relative pr-6">
                                                                        {col}
                                                                        <button onClick={() => handleDeleteColumn(col)} title="Delete Custom Column" className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
                                                                            <X className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </TableHead>
                                                                ))}

                                                                <TableHead className="font-extrabold text-purple-950 text-xs h-12 text-center whitespace-nowrap">Dispensed</TableHead>
                                                                <TableHead className="font-extrabold text-purple-950 text-xs h-12 text-center whitespace-nowrap min-w-[140px]">Current Stock</TableHead>
                                                                <TableHead className="text-right font-extrabold text-purple-950 text-xs h-12 pr-6 whitespace-nowrap sticky right-0 bg-purple-50/95 backdrop-blur-md z-10 border-l border-purple-100">Actions</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {paginatedItems.map((item) => {
                                                                const health = evaluateItemHealth(item);
                                                                const isLowStock = health.isLowStock || health.isZero;
                                                                const isBackorder = health.isBackorder;
                                                                const isExpired = health.isExpired;

                                                                return (
                                                                    <TableRow
                                                                        key={item.id}
                                                                        className={cn(
                                                                            "transition-all duration-300 ease-out group",
                                                                            isExpired ? "bg-slate-100/90 opacity-70" :
                                                                                isBackorder ? "bg-orange-50/40 hover:bg-orange-50/80" :
                                                                                    isLowStock ? "bg-amber-50/30 hover:bg-amber-50/70" :
                                                                                        "hover:bg-purple-50/40",
                                                                            recentlyUpdatedId === item.id && "bg-purple-100/70 ring-1 ring-purple-400"
                                                                        )}
                                                                    >
                                                                        <TableCell className="font-bold text-slate-800 pl-6 whitespace-nowrap">
                                                                            <div className="flex items-center gap-3">
                                                                                {item.imageUrl ? (
                                                                                    <img src={item.imageUrl} alt="Asset" width={34} height={34} loading="lazy" decoding="async" className="w-8.5 h-8.5 rounded-xl object-cover border border-purple-100 shadow-2xs shrink-0" />
                                                                                ) : (
                                                                                    <div className="w-8.5 h-8.5 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                                                                                        {category === 'vaccinations' ? <Syringe className="w-4 h-4" /> : category === 'blood_tests' ? <TestTube className="w-4 h-4" /> : category === 'consumables' ? <Box className="w-4 h-4" /> : <Pill className="w-4 h-4" />}
                                                                                    </div>
                                                                                )}
                                                                                <EditableCell value={item.name} onSave={(val) => handleInlineSave(item, 'name', val)} className="text-sm font-bold text-slate-900" />
                                                                            </div>
                                                                        </TableCell>

                                                                        {category === 'medications' && (
                                                                            <>
                                                                                <TableCell><EditableCell value={item.dosage} onSave={(val) => handleInlineSave(item, 'dosage', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.type} onSave={(val) => handleInlineSave(item, 'type', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.usedForAge} onSave={(val) => handleInlineSave(item, 'usedForAge', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.supplier || ""} onSave={(val) => handleInlineSave(item, 'supplier', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.description} onSave={(val) => handleInlineSave(item, 'description', val)} /></TableCell>
                                                                            </>
                                                                        )}

                                                                        {category === 'vaccinations' && (
                                                                            <>
                                                                                <TableCell><EditableCell value={item.supplier || ""} onSave={(val) => handleInlineSave(item, 'supplier', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.usedForAge} onSave={(val) => handleInlineSave(item, 'usedForAge', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.fundingSource || "Private / Clinic Stock"} onSave={(val) => handleInlineSave(item, 'fundingSource', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.subCategory || ""} onSave={(val) => handleInlineSave(item, 'subCategory', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.storageTemp || ""} onSave={(val) => handleInlineSave(item, 'storageTemp', val)} /></TableCell>
                                                                                <TableCell>
                                                                                    <Switch checked={item.requiresReconstitution} onCheckedChange={(val) => handleInlineSave(item, 'requiresReconstitution', val)} className="scale-75 origin-left data-[state=checked]:bg-purple-600" />
                                                                                </TableCell>
                                                                                <TableCell><EditableCell value={item.location || ""} onSave={(val) => handleInlineSave(item, 'location', val)} /></TableCell>
                                                                                <TableCell>
                                                                                    <div className="flex gap-1 flex-wrap w-32">
                                                                                        {item.tags?.map(t => <span key={t} className="text-[9px] font-bold bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded-md text-purple-700 whitespace-nowrap">{t}</span>)}
                                                                                    </div>
                                                                                </TableCell>
                                                                                <TableCell>
                                                                                    <div className="flex flex-col gap-0.5">
                                                                                        <span className="text-xs font-mono font-bold text-slate-700"><EditableCell value={item.batchNumber || ""} onSave={(val) => handleInlineSave(item, 'batchNumber', val)} /></span>
                                                                                        <span className={cn("text-[10px] font-bold w-fit px-1.5 rounded", isExpired ? "text-white bg-red-600" : health.isExpiringSoon ? "text-orange-800 bg-orange-100" : "text-red-500 bg-red-50")}><EditableCell type="date" value={item.expiryDate || ""} prefix="Exp: " onSave={(val) => handleInlineSave(item, 'expiryDate', val)} /></span>
                                                                                    </div>
                                                                                </TableCell>
                                                                            </>
                                                                        )}

                                                                        {category === 'blood_tests' && (
                                                                            <>
                                                                                <TableCell><EditableCell value={item.subCategory || ""} onSave={(val) => handleInlineSave(item, 'subCategory', val)} /></TableCell>
                                                                                <TableCell><span className="font-mono font-bold"><EditableCell value={item.batchNumber || ""} onSave={(val) => handleInlineSave(item, 'batchNumber', val)} /></span></TableCell>
                                                                                <TableCell><EditableCell type="date" value={item.arrivalDate || ""} onSave={(val) => handleInlineSave(item, 'arrivalDate', val)} /></TableCell>
                                                                                <TableCell><span className={cn("text-[10px] font-bold w-fit px-1.5 rounded", isExpired ? "text-white bg-red-600" : health.isExpiringSoon ? "text-orange-800 bg-orange-100" : "text-red-500 bg-red-50")}><EditableCell type="date" value={item.expiryDate || ""} onSave={(val) => handleInlineSave(item, 'expiryDate', val)} /></span></TableCell>
                                                                                <TableCell><EditableCell value={item.location || ""} onSave={(val) => handleInlineSave(item, 'location', val)} /></TableCell>
                                                                                <TableCell>
                                                                                    <div className="flex gap-1 flex-wrap w-32">
                                                                                        {item.tags?.map(t => <span key={t} className="text-[9px] font-bold bg-purple-50 border border-purple-100 px-1.5 py-0.5 rounded-md text-purple-700 whitespace-nowrap">{t}</span>)}
                                                                                    </div>
                                                                                </TableCell>
                                                                                <TableCell><EditableCell value={item.supplier || ""} onSave={(val) => handleInlineSave(item, 'supplier', val)} /></TableCell>
                                                                            </>
                                                                        )}

                                                                        {category === 'consumables' && (
                                                                            <>
                                                                                <TableCell><EditableCell value={item.specification || ""} onSave={(val) => handleInlineSave(item, 'specification', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.subCategory || ""} onSave={(val) => handleInlineSave(item, 'subCategory', val)} /></TableCell>
                                                                                <TableCell>
                                                                                    <Switch checked={item.isSterile} onCheckedChange={(val) => handleInlineSave(item, 'isSterile', val)} className="scale-75 origin-left data-[state=checked]:bg-emerald-500" />
                                                                                </TableCell>
                                                                                <TableCell>
                                                                                    {item.hasExpiry === false ? (
                                                                                        <span className="text-[10px] font-bold text-slate-400">Non-Expiring</span>
                                                                                    ) : (
                                                                                        <div className="flex flex-col gap-0.5">
                                                                                            <span className="text-xs font-mono font-bold text-slate-700"><EditableCell value={item.batchNumber || ""} onSave={(val) => handleInlineSave(item, 'batchNumber', val)} /></span>
                                                                                            <span className={cn("text-[10px] font-bold w-fit px-1.5 rounded", isExpired ? "text-white bg-red-600" : health.isExpiringSoon ? "text-orange-800 bg-orange-100" : "text-red-500 bg-red-50")}><EditableCell type="date" value={item.expiryDate || ""} prefix="Exp: " onSave={(val) => handleInlineSave(item, 'expiryDate', val)} /></span>
                                                                                        </div>
                                                                                    )}
                                                                                </TableCell>
                                                                                <TableCell><EditableCell value={item.location || ""} onSave={(val) => handleInlineSave(item, 'location', val)} /></TableCell>
                                                                                <TableCell><EditableCell value={item.supplier || ""} onSave={(val) => handleInlineSave(item, 'supplier', val)} /></TableCell>
                                                                            </>
                                                                        )}

                                                                        <TableCell><EditableCell type="number" value={item.minStockThreshold || 10} onSave={(val) => handleInlineSave(item, 'minStockThreshold', val)} /></TableCell>
                                                                        <TableCell className="text-slate-700 font-bold"><EditableCell type="number" value={item.price} onSave={(val) => handleInlineSave(item, 'price', val)} prefix="₹" /></TableCell>

                                                                        {/* Dynamic Smart Columns Rendering (Inline Editable) */}
                                                                        {dynamicColumns.map(col => (
                                                                            <TableCell key={col} className="text-slate-600 text-xs truncate max-w-[150px]">
                                                                                <EditableCell value={item.customFields?.[col] || ''} onSave={(val) => handleInlineCustomFieldSave(item, col, val)} />
                                                                            </TableCell>
                                                                        ))}
                                                                        <TableCell className="text-center text-slate-500 font-bold text-xs">{item.dispensed}</TableCell>

                                                                        <TableCell className="text-center font-black">
                                                                            <div className="flex flex-col items-center gap-1">
                                                                                {isBackorder ? (
                                                                                    <Badge variant="destructive" className="mx-auto flex items-center justify-center w-fit gap-1.5 px-3 py-1 bg-red-100 text-red-700 hover:bg-red-200 border border-red-200 rounded-lg shadow-2xs whitespace-nowrap">
                                                                                        <AlertTriangle className="w-3.5 h-3.5" />
                                                                                        0 (Need: {Math.abs(item.currentStock)})
                                                                                    </Badge>
                                                                                ) : isLowStock && !isExpired ? (
                                                                                    <Badge variant="destructive" className="mx-auto flex items-center justify-center w-fit gap-1.5 px-3 py-1 bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-200 rounded-lg shadow-2xs">
                                                                                        <AlertTriangle className="w-3.5 h-3.5" />
                                                                                        {item.currentStock} (Low)
                                                                                    </Badge>
                                                                                ) : (
                                                                                    <Badge className="mx-auto px-3 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/80 rounded-lg shadow-2xs font-extrabold">
                                                                                        {item.currentStock}
                                                                                    </Badge>
                                                                                )}
                                                                                <div className="w-16 h-1 bg-slate-100 rounded-full overflow-hidden">
                                                                                    <div
                                                                                        className={cn("h-full rounded-full", isBackorder || isLowStock ? "bg-amber-500" : "bg-emerald-500")}
                                                                                        style={{ width: `${Math.max(8, health.capacityPercentage)}%` }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        </TableCell>

                                                                        <TableCell className="text-right pr-4 sticky right-0 bg-white/95 group-hover:bg-purple-50/95 backdrop-blur-md z-10 border-l border-purple-100/60 transition-colors">
                                                                            <div className="flex items-center justify-end gap-1">
                                                                                {!isExpired && <RefillStockDialog item={item} onRefillSuccess={triggerHighlight} />}
                                                                                <LogWastageDialog item={item} isExpired={isExpired} onWastageLogged={triggerHighlight} />
                                                                                {isExpired && (
                                                                                    <Badge variant="destructive" className="mr-1 bg-red-600 hover:bg-red-600 shadow-xs text-[10px] px-2 py-0.5">EXPIRED</Badge>
                                                                                )}
                                                                                <Button variant="ghost" size="icon" title="Edit Item" onClick={() => { setEditingItem(item); setAddModalOpen(true); }} className="text-purple-600 hover:text-purple-800 hover:bg-purple-100/70 h-8 w-8 rounded-xl transition-all">
                                                                                    <Edit2 className="w-4 h-4" />
                                                                                </Button>
                                                                                <AlertDialog>
                                                                                    <AlertDialogTrigger asChild>
                                                                                        <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 rounded-xl transition-all">
                                                                                            <Trash2 className="w-4 h-4" />
                                                                                        </Button>
                                                                                    </AlertDialogTrigger>
                                                                                    <AlertDialogContent className="rounded-3xl border-red-100 shadow-2xl">
                                                                                        <AlertDialogHeader>
                                                                                            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-2 mx-auto">
                                                                                                <AlertTriangle className="w-6 h-6 text-red-600" />
                                                                                            </div>
                                                                                            <AlertDialogTitle className="text-center text-red-600 text-xl">Delete {item.name}?</AlertDialogTitle>
                                                                                            <AlertDialogDescription className="text-center">This will permanently delete this item from your inventory.</AlertDialogDescription>
                                                                                        </AlertDialogHeader>
                                                                                        <AlertDialogFooter className="sm:justify-center gap-2 mt-4">
                                                                                            <AlertDialogCancel className="rounded-xl px-6">Cancel</AlertDialogCancel>
                                                                                            <AlertDialogAction onClick={() => handleDeleteStock(item)} className="rounded-xl px-6 bg-red-600 hover:bg-red-700 shadow-md">Delete Item</AlertDialogAction>
                                                                                        </AlertDialogFooter>
                                                                                    </AlertDialogContent>
                                                                                </AlertDialog>
                                                                            </div>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                );
                                                            })}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </div>
                                        )}

                                        {/* Client Pagination Controls */}
                                        {totalPages > 1 && (
                                            <div className="flex flex-col sm:flex-row items-center justify-between mt-5 px-4 py-3 bg-white rounded-2xl border border-purple-100/80 shadow-2xs gap-3">
                                                <span className="text-xs font-semibold text-slate-500">
                                                    Showing <strong className="text-purple-950">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> to <strong className="text-purple-950">{Math.min(currentPage * ITEMS_PER_PAGE, categoryItems.length)}</strong> of <strong className="text-purple-950">{categoryItems.length}</strong> assets
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <Button variant="outline" size="sm" className="h-8 rounded-xl border-purple-200 text-purple-700 font-bold text-xs" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                                                        <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Previous
                                                    </Button>
                                                    <span className="text-xs font-extrabold bg-purple-50 border border-purple-100 text-purple-800 px-3.5 py-1.5 rounded-xl">
                                                        Page {currentPage} of {totalPages}
                                                    </span>
                                                    <Button variant="outline" size="sm" className="h-8 rounded-xl border-purple-200 text-purple-700 font-bold text-xs" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
                                                        Next <ArrowRight className="w-3.5 h-3.5 ml-1" />
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </TabsContent>

                                    {/* ─── STATISTICS & STOCK HEALTH ANALYTICS SUB-TAB ─── */}
                                    <TabsContent value="stats" className="mt-0">
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 animate-in zoom-in-95 duration-300">

                                            {/* Left Column: Real-Time Stock Health Donut Breakdown */}
                                            <Card className="border-purple-100/80 shadow-xs bg-white rounded-2xl overflow-hidden">
                                                <CardHeader className="pb-3 bg-purple-50/40 border-b border-purple-100/60">
                                                    <CardTitle className="text-base flex items-center gap-2 text-purple-950 font-extrabold">
                                                        <div className="p-1.5 bg-purple-100 rounded-lg"><Activity className="w-4 h-4 text-purple-600" /></div>
                                                        Category Health Breakdown
                                                    </CardTitle>
                                                    <CardDescription className="text-xs text-slate-500">
                                                        Live distribution of {categoryLabel.toLowerCase()} stock readiness.
                                                    </CardDescription>
                                                </CardHeader>
                                                <CardContent className="pt-6 flex flex-col items-center">
                                                    <div className="relative w-40 h-40 flex items-center justify-center">
                                                        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                                                            <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f1f5f9" strokeWidth="3.8" />
                                                            <circle
                                                                cx="18"
                                                                cy="18"
                                                                r="15.915"
                                                                fill="none"
                                                                stroke="#10b981"
                                                                strokeWidth="3.8"
                                                                strokeDasharray={`${inventoryMetrics.healthyPct} ${100 - inventoryMetrics.healthyPct}`}
                                                                strokeLinecap="round"
                                                            />
                                                        </svg>
                                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                                                            <span className="text-3xl font-black text-purple-950">{inventoryMetrics.healthyPct}%</span>
                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Healthy</span>
                                                        </div>
                                                    </div>

                                                    <div className="w-full space-y-2.5 mt-6 text-xs">
                                                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
                                                            <span className="flex items-center gap-2 font-bold text-emerald-900">
                                                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Optimal Stock
                                                            </span>
                                                            <span className="font-black text-emerald-700">{inventoryMetrics.healthyCount} items</span>
                                                        </div>
                                                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/60 border border-amber-100">
                                                            <span className="flex items-center gap-2 font-bold text-amber-900">
                                                                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Low Stock
                                                            </span>
                                                            <span className="font-black text-amber-700">{inventoryMetrics.lowStockCount} items</span>
                                                        </div>
                                                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-red-50/60 border border-red-100">
                                                            <span className="flex items-center gap-2 font-bold text-red-900">
                                                                <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Depleted / Backorder
                                                            </span>
                                                            <span className="font-black text-red-700">{inventoryMetrics.criticalCount} items</span>
                                                        </div>
                                                        <div className="flex items-center justify-between p-2.5 rounded-xl bg-orange-50/60 border border-orange-100">
                                                            <span className="flex items-center gap-2 font-bold text-orange-900">
                                                                <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Expiring / Expired
                                                            </span>
                                                            <span className="font-black text-orange-700">{inventoryMetrics.expiringAttentionCount} items</span>
                                                        </div>
                                                    </div>
                                                </CardContent>
                                            </Card>

                                            {/* Right 2 Columns: Top Dispensed Items Leaderboard */}
                                            <Card className="lg:col-span-2 border-purple-100/80 shadow-xs bg-white rounded-2xl overflow-hidden">
                                                <CardHeader className="pb-3 bg-fuchsia-50/30 border-b border-fuchsia-100/60">
                                                    <CardTitle className="text-base flex items-center gap-2 text-fuchsia-950 font-extrabold">
                                                        <div className="p-1.5 bg-fuchsia-100 rounded-lg"><TrendingUp className="w-4 h-4 text-fuchsia-600" /></div>
                                                        Most Dispensed {categoryLabel}
                                                    </CardTitle>
                                                    <CardDescription className="text-xs text-slate-500">
                                                        Automatically tracked based on your in-house clinical consultations and logs.
                                                    </CardDescription>
                                                </CardHeader>
                                                <CardContent className="pt-5">
                                                    {loading ? (
                                                        <div className="py-12 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-fuchsia-400" /></div>
                                                    ) : topUsed.length > 0 ? (
                                                        <div className="space-y-3">
                                                            {topUsed.map((item, idx) => {
                                                                const percentage = Math.max(6, (item.dispensed / maxDispensed) * 100);
                                                                return (
                                                                    <div key={item.id} className="bg-slate-50/60 p-3.5 rounded-2xl border border-purple-100/60 flex items-center gap-4 hover:border-fuchsia-200 hover:bg-white transition-all group">
                                                                        <div className="w-8 h-8 rounded-xl bg-fuchsia-100/80 text-fuchsia-700 font-black text-xs flex items-center justify-center shrink-0">
                                                                            #{idx + 1}
                                                                        </div>
                                                                        <div className="flex-1 min-w-0">
                                                                            <div className="flex justify-between items-center mb-1.5 gap-2">
                                                                                <span className="font-extrabold text-xs sm:text-sm text-slate-800 truncate">
                                                                                    {item.name} {item.dosage && <span className="text-slate-400 font-medium">({item.dosage})</span>}
                                                                                </span>
                                                                                <span className="text-xs font-extrabold text-fuchsia-700 bg-fuchsia-100/80 px-2.5 py-0.5 rounded-lg shrink-0">
                                                                                    {item.dispensed} dispensed
                                                                                </span>
                                                                            </div>
                                                                            <div className="w-full bg-slate-200/70 rounded-full h-2.5 overflow-hidden">
                                                                                <div className="bg-gradient-to-r from-fuchsia-500 via-purple-600 to-violet-600 h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${percentage}%` }} />
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <div className="text-center py-14 text-slate-400">
                                                            <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mx-auto mb-3 border border-slate-100">
                                                                <BarChart3 className="w-7 h-7 text-fuchsia-300" />
                                                            </div>
                                                            <p className="font-bold text-slate-600 text-sm">No usage velocity recorded yet.</p>
                                                            <p className="text-xs mt-1 text-slate-400">Items will rank here automatically once dispensed to patients.</p>
                                                        </div>
                                                    )}
                                                </CardContent>
                                            </Card>
                                        </div>
                                    </TabsContent>

                                </Tabs>
                            </TabsContent>
                        );
                    })}

                    {/* ─────────────────────────────────────────────────────────
                       D. USAGE & ACTIVITY LOGS TAB
                       ───────────────────────────────────────────────────────── */}
                    <TabsContent value="log" className="mt-6 min-h-[500px] animate-in slide-in-from-bottom-2 fade-in duration-500">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3 bg-white p-3.5 rounded-2xl border border-purple-100/80 shadow-2xs z-40 relative">
                            <div>
                                <h3 className="text-sm font-extrabold text-purple-950 flex items-center gap-2">
                                    <History className="w-4 h-4 text-purple-600" /> Real-Time Inventory Audit Trail
                                </h3>
                                <p className="text-xs text-slate-500">Chronological ledger of all stock refills, patient dispensations, and wastage disposals.</p>
                            </div>
                            <div className="relative w-full sm:w-72">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-purple-400" />
                                <Input
                                    placeholder="Search logs by item, patient, or note..."
                                    value={localSearch}
                                    onFocus={() => setShowDropdown(true)}
                                    onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                                    onChange={e => {
                                        setLocalSearch(e.target.value);
                                        setShowDropdown(true);
                                        setLogsPage(1);
                                    }}
                                    className="pl-9 h-10 bg-slate-50/70 focus:bg-white border-purple-100 rounded-xl focus-visible:ring-purple-500 text-xs shadow-2xs"
                                />

                                {showDropdown && localSearch.trim() && filteredLogs.length > 0 &&
                                    !(filteredLogs.length === 1 && filteredLogs[0].itemName.toLowerCase() === localSearch.toLowerCase()) && (
                                        <div className="absolute top-full left-0 sm:left-auto sm:right-0 mt-1.5 w-full sm:w-[400px] max-h-72 overflow-y-auto bg-white border border-purple-100 shadow-2xl rounded-2xl p-1.5 flex flex-col gap-1 z-[100]">
                                            {Array.from(new Set(filteredLogs.map(l => l.itemName))).slice(0, 10).map((uniqueItemName, idx) => (
                                                <div
                                                    key={idx}
                                                    className="p-2.5 hover:bg-purple-50 rounded-xl cursor-pointer transition-colors flex justify-between items-center gap-4"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => {
                                                        setLocalSearch(uniqueItemName);
                                                        setShowDropdown(false);
                                                        setLogsPage(1);
                                                    }}
                                                >
                                                    <p className="text-xs font-bold text-slate-900 truncate">
                                                        <HighlightedText text={uniqueItemName} highlight={localSearch} />
                                                    </p>
                                                    <span className="text-[10px] text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded-md">
                                                        Filter Logs
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                            </div>
                        </div>

                        <div className="border border-purple-100/80 rounded-2xl shadow-xs bg-white overflow-hidden transition-all duration-300">
                            <Table>
                                <TableHeader className="bg-gradient-to-r from-purple-50/80 via-violet-50/50 to-purple-50/80 border-b border-purple-100">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12 pl-6">Timestamp</TableHead>
                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12">Operation</TableHead>
                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12">Asset Name</TableHead>
                                        <TableHead className="font-extrabold text-purple-950 text-xs h-12">Patient / Audit Notes</TableHead>
                                        <TableHead className="text-right font-extrabold text-purple-950 text-xs h-12 pr-6">Stock Delta</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedLogs.length > 0 ? (
                                        paginatedLogs.map((log) => (
                                            <TableRow key={log.id} className="hover:bg-purple-50/40 transition-colors duration-200">
                                                <TableCell className="text-xs font-semibold text-slate-600 whitespace-nowrap pl-6">
                                                    {safeFormatDate(log.date, "PPp")}
                                                </TableCell>
                                                <TableCell>
                                                    {log.actionType === 'refill' ? (
                                                        <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 px-2.5 py-0.5 rounded-lg text-xs font-bold"><RefreshCw className="w-3 h-3 mr-1.5" /> Refill</Badge>
                                                    ) : log.actionType === 'wastage' ? (
                                                        <Badge className="bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 px-2.5 py-0.5 rounded-lg text-xs font-bold"><AlertOctagon className="w-3 h-3 mr-1.5" /> Wastage</Badge>
                                                    ) : (
                                                        <Badge className="bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 px-2.5 py-0.5 rounded-lg text-xs font-bold"><History className="w-3 h-3 mr-1.5" /> Dispensed</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="font-extrabold text-slate-900 text-sm">
                                                    <HighlightedText text={log.itemName} highlight={localSearch} />
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-500 font-medium">
                                                    {log.patientName ? <span className="font-bold text-purple-900 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-md mr-1.5">{log.patientName}</span> : null}
                                                    <HighlightedText text={log.notes || ""} highlight={localSearch} />
                                                </TableCell>
                                                <TableCell className={cn("text-right font-black text-base pr-6", log.actionType === 'refill' ? 'text-emerald-600' : log.actionType === 'wastage' ? 'text-orange-500' : 'text-purple-700')}>
                                                    {log.actionType === 'refill' ? '+' : '-'}{log.quantity}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="h-48 text-center text-slate-400">
                                                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3 shadow-inner">
                                                    <History className="w-6 h-6 text-purple-300" />
                                                </div>
                                                <p className="font-bold text-slate-600 text-sm">No inventory history found.</p>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {Math.ceil(filteredLogs.length / LOGS_PER_PAGE) > 1 && (
                            <div className="flex flex-col md:flex-row items-center justify-between mt-4 px-4 py-3 gap-4 bg-white rounded-2xl border border-purple-100/80 shadow-2xs">
                                <span className="text-xs font-semibold text-slate-500">
                                    Showing {(logsPage - 1) * LOGS_PER_PAGE + 1} to {Math.min(logsPage * LOGS_PER_PAGE, filteredLogs.length)} of {filteredLogs.length} logs
                                </span>
                                <div className="flex flex-wrap items-center justify-center gap-1">
                                    <Button variant="outline" size="sm" className="h-8 rounded-xl border-purple-200 text-purple-700 font-bold text-xs" disabled={logsPage === 1} onClick={() => setLogsPage(p => Math.max(1, p - 1))}>
                                        <ArrowLeft className="w-3 h-3 mr-1" /> Prev
                                    </Button>
                                    {(() => {
                                        const totalLogPages = Math.ceil(filteredLogs.length / LOGS_PER_PAGE);
                                        let pages: (number | string)[] = [];
                                        if (totalLogPages <= 7) {
                                            for (let i = 1; i <= totalLogPages; i++) pages.push(i);
                                        } else {
                                            if (logsPage <= 4) pages = [1, 2, 3, 4, 5, '...', totalLogPages];
                                            else if (logsPage >= totalLogPages - 3) pages = [1, '...', totalLogPages - 4, totalLogPages - 3, totalLogPages - 2, totalLogPages - 1, totalLogPages];
                                            else pages = [1, '...', logsPage - 1, logsPage, logsPage + 1, '...', totalLogPages];
                                        }
                                        return pages.map((page, idx) => {
                                            if (page === '...') return <span key={`ellipsis-${idx}`} className="px-2 text-slate-400 font-bold tracking-widest">...</span>;
                                            return (
                                                <button key={page} onClick={() => setLogsPage(page as number)} className={cn("w-8 h-8 rounded-xl text-xs font-bold transition-colors border", logsPage === page ? "bg-purple-600 text-white border-purple-600 shadow-xs" : "bg-white text-slate-600 border-slate-200 hover:bg-purple-50")}>
                                                    {page}
                                                </button>
                                            );
                                        });
                                    })()}
                                    <Button variant="outline" size="sm" className="h-8 rounded-xl border-purple-200 text-purple-700 font-bold text-xs" disabled={logsPage === Math.ceil(filteredLogs.length / LOGS_PER_PAGE)} onClick={() => setLogsPage(p => Math.min(Math.ceil(filteredLogs.length / LOGS_PER_PAGE), p + 1))}>
                                        Next <ArrowRight className="w-3 h-3 ml-1" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </CardContent>

            {/* 📥 DOWNLOAD PDF REPORT DIALOG */}
            <Dialog open={downloadOpen} onOpenChange={setDownloadOpen}>
                <DialogContent className="sm:max-w-md rounded-3xl bg-white/95 backdrop-blur-2xl border-purple-100 shadow-2xl">
                    <DialogHeader className="pb-2 border-b border-purple-50">
                        <DialogTitle className="flex items-center gap-3 text-xl font-extrabold text-purple-950">
                            <div className="w-10 h-10 rounded-2xl bg-purple-100 flex items-center justify-center">
                                <Download className="w-5 h-5 text-purple-600" />
                            </div>
                            Export Clinic Inventory Report
                        </DialogTitle>
                        <DialogDescription className="ml-1 pl-12 text-xs text-purple-700/70">
                            Generate a formatted PDF audit containing current stock valuations and historical usage logs.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-4 px-2">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold uppercase tracking-wider text-purple-700">Audit Log Timeframe</Label>
                            <Select value={reportRange} onValueChange={setReportRange}>
                                <SelectTrigger className="h-11 bg-slate-50/70 border-purple-100 rounded-xl focus:ring-purple-500 font-semibold text-xs shadow-2xs">
                                    <SelectValue placeholder="Select range..." />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-purple-100">
                                    <SelectItem value="1month">Last 1 Month</SelectItem>
                                    <SelectItem value="6months">Last 6 Months</SelectItem>
                                    <SelectItem value="1year">Last 1 Year</SelectItem>
                                    <SelectItem value="all">All Time</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter className="pt-3 border-t border-purple-50">
                        <Button variant="ghost" onClick={() => setDownloadOpen(false)} className="rounded-xl hover:bg-purple-50 text-purple-700 h-10 px-5 text-xs font-semibold">Cancel</Button>
                        <Button onClick={handleDownloadPdf} disabled={isDownloading} className="rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white shadow-lg shadow-purple-200 transition-all h-10 px-6 text-xs font-bold">
                            {isDownloading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                            {isDownloading ? "Generating PDF..." : "Export PDF Report"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AddInventoryItemDialog
                open={addModalOpen}
                onOpenChange={setAddModalOpen}
                currentTab={activeTab}
                editingItem={editingItem}
                clearEdit={() => setEditingItem(null)}
                dynamicCols={dynamicColumns}
                onItemSaved={triggerHighlight}
            />
        </Card>
    );
}