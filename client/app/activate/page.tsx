"use client"

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { TbActivityHeartbeat } from "react-icons/tb";
import { FaCheckCircle, FaTimesCircle, FaKey, FaUser } from "react-icons/fa";

export default function ActivatePage() {
    const [key, setKey] = useState("");
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const router = useRouter();
    const supabase = createClient();


    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (user) {
                setUserEmail(user.email || null);
            } else if (error) {
                console.error("Error fetching user:", error);
            }
        };
        fetchUser();
    }, []);

    const handleActivate = async () => {
        if (!key) return;

        setStatus("loading");
        setMessage("");

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                setStatus("error");
                setMessage("You must be logged in to activate a license.");
                return;
            }

            const res = await fetch("/api/activate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session.access_token}`
                },
                body: JSON.stringify({ licenseKey: key })
            });

            const result = await res.json();

            if (res.ok && result.valid) {
                setStatus("success");
                setMessage("License activated successfully!");
                setTimeout(() => router.push("/detect"), 1500);
            } else {
                setStatus("error");
                setMessage(result.error || "Invalid license key.");
            }

        } catch (err) {
            console.error(err);
            setStatus("error");
            setMessage("An unexpected error occurred.");
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center px-4 relative">
            {/* Close button */}
            <button
                onClick={() => router.push("/detect")}
                className="absolute top-5 right-5 text-neutral-400 hover:text-red-500 transition-colors text-3xl"
                aria-label="Close"
            >
                ×
            </button>

            <h1 className="text-lg font-semibold flex items-center gap-1 mb-2">
                <TbActivityHeartbeat className="text-3xl text-red-500" />
                BEATMARKER
            </h1>

            {/* User email */}
            {userEmail && (
                <div className="flex items-center gap-2 mb-4 text-neutral-300 text-sm">
                    <FaUser /> {userEmail}<a href="/">not you?</a>
                </div>
            )}

            <div className="w-full max-w-md bg-neutral-900 rounded-lg p-6 border border-neutral-800 space-y-4">
                <label className="text-sm text-neutral-400 flex items-center gap-2">
                    <FaKey /> License Key
                </label>
                <input
                    type="text"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="Enter your Gumroad license key"
                    className="w-full px-3 py-2 rounded bg-neutral-800 border border-neutral-700 text-sm text-neutral-200 focus:outline-none focus:border-red-500"
                />

                <button
                    onClick={handleActivate}
                    disabled={status === "loading"}
                    className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {status === "loading" ? "Verifying..." : "Activate"}
                </button>

                {status === "success" && (
                    <p className="text-green-500 flex items-center gap-2 text-sm">
                        <FaCheckCircle /> {message}
                    </p>
                )}

                {status === "error" && (
                    <p className="text-red-500 flex items-center gap-2 text-sm">
                        <FaTimesCircle /> {message}
                    </p>
                )}
            </div>

            <p className="text-xs text-neutral-500 mt-4 text-center">
                Don’t have a license key? Purchase one on Gumroad.
            </p>
        </div>
    );
}
