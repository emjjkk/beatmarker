"use client"

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from '@/utils/supabase/client';
import { TbActivityHeartbeat } from "react-icons/tb";
import { FaGoogle, FaDiscord, FaGithub } from "react-icons/fa6";
import { LuMenu, LuX } from "react-icons/lu";

export default function Home() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [userName, setUserName] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    const checkAuthAndShowWelcome = async () => {
      if (searchParams.get('auth') === 'success') {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          const name = user.user_metadata?.full_name || 
                       user.user_metadata?.name || 
                       user.email?.split('@')[0] || 
                       'there';
          
          setUserName(name);
          
          // Check if this is a new user (created within last 10 seconds)
          const userCreatedAt = new Date(user.created_at).getTime();
          const now = Date.now();
          const isNewUser = (now - userCreatedAt) < 10000;
          
          setWelcomeMessage(isNewUser ? `Welcome, ${name}!` : `Welcome back, ${name}!`);
          
          // Redirect to /app after 2 seconds
          setTimeout(() => {
            router.push('/detect');
          }, 2000);
        }
      }
    };

    checkAuthAndShowWelcome();
  }, [searchParams, router]);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleOAuthLogin = async (provider: 'google' | 'discord' | 'github') => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        console.error('Auth error:', error);
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setIsLoading(false);
    }
  };

  return (
    <>
      <main className="w-full h-screen flex flex-col items-center justify-center">
        <h1 className="text-lg font-semibold flex items-center gap-1 mb-5">
          <TbActivityHeartbeat className="text-3xl text-red-500" />
          BEATMARKER
        </h1>
        <p className="text-center text-md max-w-md mb-10">
          Automatically detect drops from audio files and generate timeline markers for Davinci Resolve, Adobe Premiere Pro, etc. for faster video editing.
        </p>
        
        {welcomeMessage ? (
          <p className="text-sm text-green-600 dark:text-green-400 mb-3 font-medium animate-pulse">
            {welcomeMessage}
          </p>
        ) : (
          <p className="text-sm text-foreground/50 mb-3">
            Login or sign up to continue
          </p>
        )}
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOAuthLogin('google')}
            disabled={isLoading}
            className="flex items-center justify-center w-8 h-8 rounded-sm bg-foreground text-background hover:bg-red-400 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Sign in with Google"
          >
            <FaGoogle className="text-sm" />
          </button>
          <button
            onClick={() => handleOAuthLogin('discord')}
            disabled={isLoading}
            className="flex items-center justify-center w-8 h-8 rounded-sm bg-foreground text-background hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Sign in with Discord"
          >
            <FaDiscord className="text-sm" />
          </button>
          <button
            onClick={() => handleOAuthLogin('github')}
            disabled={isLoading}
            className="flex items-center justify-center w-8 h-8 rounded-sm bg-foreground text-background hover:bg-neutral-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Sign in with GitHub"
          >
            <FaGithub className="text-sm" />
          </button>
        </div>
      </main>
      <div className="absolute bottom-0 w-full py-2 text-center text-sm text-foreground/50">
        <p>v1.0.0 last updated Dec 2025 ▪ Built with  🥤 by @emjjkk</p>
      </div>
    </>
  );
}