"use client"
import { useState, useEffect, useCallback } from "react";
import { createClient } from '@/utils/supabase/client';
import { User } from '@supabase/supabase-js';
import { TbActivityHeartbeat } from "react-icons/tb";
import { FaHelicopter, FaCircleUser, FaUpload, FaSpinner, FaDownload, FaCircleInfo, FaChevronDown, FaChevronUp, FaCat, FaCheck, FaXmark, FaProductHunt, FaClock, FaTrash, FaHourglass } from "react-icons/fa6";
import { SiBuymeacoffee } from "react-icons/si";
import InfoModal from '@/components/info';

interface ProcessingResult {
    id: string;
    fileName: string;
    settings: {
        fps: number;
        sensitivity: string;
        loudness: number;
        minGap: number;
        beatsOnly: boolean;
        markerColor?: string;
        markerName?: string;
        includeTimestamps?: boolean;
    };
    timestamp: string;
    beatsUrl: string;
    markersUrl: string;
    beatsCount?: number;
    duration?: number;
    avgSpacing?: number;
}

interface QueueItem {
    id: string;
    fileName: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    position?: number;
    result?: ProcessingResult;
    error?: string;
    createdAt: string;
}

export default function HomePage() {
    const endpointUrl = 'https://beatmarker.onrender.com';
    const [user, setUser] = useState<User | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isDragging, setIsDragging] = useState(false);
    const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
    const [fps, setFps] = useState(30);
    const [sensitivity, setSensitivity] = useState('low');
    const [loudness, setLoudness] = useState(70);
    const [minGap, setMinGap] = useState(0.5);
    const [beatsOnly, setBeatsOnly] = useState(false);
    const [markerColor, setMarkerColor] = useState('red');
    const [markerName, setMarkerName] = useState('Beat');
    const [includeTimestamps, setIncludeTimestamps] = useState(true);
    const [results, setResults] = useState<ProcessingResult[]>([]);
    const [optionsExpanded, setOptionsExpanded] = useState(false);
    const [outputExpanded, setOutputExpanded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const supabase = createClient();

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const { data: { user }, error } = await supabase.auth.getUser();
                if (error) {
                    console.error('Error fetching user:', error);
                    window.location.href = '/';
                } else if (!user) {
                    window.location.href = '/';
                } else {
                    setUser(user);
                }
            } catch (error) {
                console.error('Unexpected error:', error);
                window.location.href = '/';
            } finally {
                setIsLoading(false);
            }
        };
        fetchUser();
    }, []);

    const fetchHistory = async () => {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
            try {
                const response = await fetch(`${endpointUrl}/api/history`, {
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch history');
                }

                const data = await response.json();
                setResults(data);
            } catch (error) {
                console.error('Error fetching history:', error);
            }
        }
    };

    const fetchQueueStatus = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
            try {
                const response = await fetch(`${endpointUrl}/api/queue/user`, {
                    headers: {
                        'Authorization': `Bearer ${session.access_token}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch queue');
                }

                const data = await response.json();
                
                // Update queue items
                setQueueItems(data);

                // Check for completed items
                const completedIds = queueItems
                    .filter(item => item.status === 'processing' || item.status === 'pending')
                    .map(item => item.id);

                for (const queueId of completedIds) {
                    const statusResponse = await fetch(`${endpointUrl}/api/queue/status/${queueId}`, {
                        headers: {
                            'Authorization': `Bearer ${session.access_token}`
                        }
                    });

                    if (statusResponse.ok) {
                        const statusData = await statusResponse.json();
                        
                        if (statusData.status === 'completed' && statusData.result) {
                            // Add to results
                            setResults(prev => [statusData.result, ...prev]);
                            
                            // Remove from queue after a delay
                            setTimeout(() => {
                                setQueueItems(prev => prev.filter(item => item.id !== queueId));
                            }, 3000);
                        } else if (statusData.status === 'failed') {
                            setError(statusData.error || 'Processing failed');
                            
                            // Remove failed item after delay
                            setTimeout(() => {
                                setQueueItems(prev => prev.filter(item => item.id !== queueId));
                            }, 5000);
                        }
                    }
                }
            } catch (error) {
                console.error('Error fetching queue:', error);
            }
        }
    }, [queueItems]);

    // Poll queue status every 3 seconds
    useEffect(() => {
        if (user && queueItems.length > 0) {
            const interval = setInterval(fetchQueueStatus, 3000);
            return () => clearInterval(interval);
        }
    }, [user, queueItems.length, fetchQueueStatus]);

    useEffect(() => {
        if (user) {
            fetchHistory();
            fetchQueueStatus();
        }
    }, [user]);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        const audioFiles = droppedFiles.filter(f => f.type.startsWith('audio/'));

        if (audioFiles.length === 0) {
            setError('Please upload audio files');
            return;
        }

        audioFiles.forEach(file => uploadToQueue(file));
        setError(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = e.target.files;
        if (selectedFiles) {
            Array.from(selectedFiles).forEach(file => uploadToQueue(file));
            setError(null);
        }
    };

    const uploadToQueue = async (file: File) => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('fps', fps.toString());
            formData.append('sensitivity', sensitivity);
            formData.append('loudness', loudness.toString());
            formData.append('minGap', minGap.toString());
            formData.append('beatsOnly', beatsOnly.toString());
            formData.append('markerColor', markerColor);
            formData.append('markerName', markerName);
            formData.append('includeTimestamps', includeTimestamps.toString());

            const response = await fetch(`${endpointUrl}/api/queue/add`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to add to queue');
            }

            const data = await response.json();
            
            // Add to local queue state
            setQueueItems(prev => [...prev, {
                id: data.queueId,
                fileName: file.name,
                status: 'pending',
                position: data.position,
                createdAt: new Date().toISOString()
            }]);

        } catch (err) {
            console.error('Error uploading to queue:', err);
            setError(err instanceof Error ? err.message : 'Upload failed');
        }
    };

    const handleDownload = async (url: string, filename: string) => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        try {
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${session.access_token}`
                }
            });

            if (!response.ok) throw new Error('Download failed');

            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(downloadUrl);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Download error:', error);
            setError('Download failed');
        }
    };

    const handleDeleteResult = async (processingId: string) => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        try {
            const response = await fetch(`${endpointUrl}/api/delete/${processingId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`
                }
            });

            if (!response.ok) throw new Error('Delete failed');

            setError('Result has been deleted');
            setResults(prev => prev.filter(result => result.id !== processingId));
        } catch (error) {
            console.error('Delete error:', error);
            setError('Failed to delete result');
        }
    };

    const getStatusColor = (status: QueueItem['status']) => {
        switch (status) {
            case 'pending': return 'text-yellow-500';
            case 'processing': return 'text-blue-500';
            case 'completed': return 'text-green-500';
            case 'failed': return 'text-red-500';
        }
    };

    const getStatusIcon = (status: QueueItem['status']) => {
        switch (status) {
            case 'pending': return <FaHourglass />;
            case 'processing': return <FaSpinner className="animate-spin" />;
            case 'completed': return <FaCheck />;
            case 'failed': return <FaXmark />;
        }
    };

    const getQueueMessage = (item: QueueItem) => {
        if (item.status === 'pending' && item.position) {
            if (item.position === 1) {
                return 'Next in queue';
            }
            const estimatedWait = (item.position - 1) * 7;
            return `Position ${item.position} • ~${estimatedWait}s wait`;
        }
        if (item.status === 'processing') {
            return 'Processing now...';
        }
        return '';
    };

    if (isLoading) {
        return (
            <div className="w-full h-screen flex items-center justify-center bg-neutral-950">
                <p className="text-neutral-400 text-sm">Loading...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100">
            <header className="flex items-center justify-between w-full sticky px-5 md:px-12 py-4 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                    <h1 className="text-sm font-semibold flex items-center gap-1.5 tracking-wide mr-4">
                        <TbActivityHeartbeat className="text-xl text-red-500" />
                        BEATMARKER
                    </h1>
                    <a className="md:block hidden" href="#">
                        <button className="cursor-pointer px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-md transition-colors flex gap-2 items-center"><FaProductHunt /> Vote on ProductHunt</button>
                    </a>
                    <a className="md:block hidden" href="https://buymeacoffee.com/emjjkk" target="_blank" rel="noopener noreferrer">
                        <button className="cursor-pointer px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded-md transition-colors flex gap-2 items-center"><SiBuymeacoffee /> Buy me a coffee</button>
                    </a>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col items-end">
                            <span className="md:block hidden text-xs text-neutral-300">{user?.email}</span>
                            <span className="text-xs text-neutral-500">{user?.user_metadata?.full_name}</span>
                        </div>
                        <FaCircleUser className="text-2xl text-neutral-400" />
                    </div>
                </div>
            </header>
            <main className="max-w-8xl mx-auto px-5 md:px-12 py-4">
                {error && (
                    <div className="mb-4 bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-400">
                        {error}
                    </div>
                )}

                <div className="md:grid grid-cols-2 gap-8">
                    {/* Left Column - Upload & Options */}
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-sm font-medium mb-3 text-neutral-300">Upload Audio</h2>
                            <div
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                className={`border-2 border-dashed rounded-lg py-15 text-center transition-colors ${isDragging
                                    ? 'border-red-500 bg-red-500/5'
                                    : 'border-neutral-700 hover:border-neutral-600'
                                    }`}
                            >
                                <input
                                    type="file"
                                    accept="audio/*"
                                    onChange={handleFileInput}
                                    className="hidden"
                                    id="file-input"
                                    multiple
                                />
                                <label htmlFor="file-input" className="cursor-pointer">
                                    <FaUpload className="mx-auto text-2xl text-neutral-500 mb-3" />
                                    <p className="text-sm text-neutral-400 mb-1">Drop audio files here or click to browse</p>
                                    <p className="text-xs text-neutral-600">Supported formats: MP3, WAV, FLAC, etc. Multiple files supported</p>
                                </label>
                            </div>
                        </div>

                        {/* Processing Queue */}
                        {queueItems.length > 0 && (
                            <div>
                                <h2 className="text-sm font-medium mb-3 text-neutral-300">Processing Queue</h2>
                                <div className="space-y-2">
                                    {queueItems.map((item) => (
                                        <div key={item.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                                    <span className={`${getStatusColor(item.status)}`}>
                                                        {getStatusIcon(item.status)}
                                                    </span>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm text-neutral-300 truncate">{item.fileName}</p>
                                                        <p className="text-xs text-neutral-500">{getQueueMessage(item)}</p>
                                                    </div>
                                                </div>
                                            </div>
                                            {item.status === 'processing' && (
                                                <div className="w-full bg-neutral-800 rounded-full h-1.5">
                                                    <div className="bg-blue-500 h-1.5 rounded-full animate-pulse w-full" />
                                                </div>
                                            )}
                                            {item.status === 'failed' && item.error && (
                                                <p className="text-xs text-red-400 mt-1">{item.error}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Processing Options */}
                        <div>
                            <div
                                onClick={() => setOptionsExpanded(!optionsExpanded)}
                                className="flex items-center justify-between mb-3 cursor-pointer group"
                            >
                                <h2 className="text-sm font-medium text-neutral-300 group-hover:text-neutral-200 transition-colors">
                                    Processing Options
                                </h2>
                                <div className="flex items-center gap-2">
                                    {!optionsExpanded && (
                                        <span className="hidden md:block text-xs text-neutral-500">
                                            FPS: {fps} · Sensitivity: {sensitivity} · Loudness: {loudness} · Gap: {minGap}s{beatsOnly ? ' · Beats only' : ''}
                                        </span>
                                    )}
                                    {optionsExpanded ? (
                                        <FaChevronUp className="text-neutral-500 text-xs" />
                                    ) : (
                                        <FaChevronDown className="text-neutral-500 text-xs" />
                                    )}
                                </div>
                            </div>

                            {optionsExpanded && (
                                <div className="space-y-4 bg-neutral-900 rounded-lg p-4 border border-neutral-800">
                                    <div>
                                        <label className="text-xs text-neutral-400 block mb-1.5 flex items-center gap-1.5">
                                            Frames per second
                                            <div className="group relative">
                                                <FaCircleInfo className="text-neutral-600 hover:text-neutral-400 cursor-help transition-colors" />
                                                <div className="absolute left-0 top-full mt-1 w-64 bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-lg">
                                                    Frame rate of your video project. Default is 30 FPS.
                                                </div>
                                            </div>
                                        </label>
                                        <input
                                            type="number"
                                            value={fps}
                                            onChange={(e) => setFps(Number(e.target.value))}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-xs text-neutral-400 block mb-1.5 flex items-center gap-1.5">
                                            Sensitivity
                                            <div className="group relative">
                                                <FaCircleInfo className="text-neutral-600 hover:text-neutral-400 cursor-help transition-colors" />
                                                <div className="absolute left-0 top-full mt-1 w-64 bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-lg">
                                                    Detection sensitivity. Very low = only major drops. Higher sensitivity captures more subtle beats.
                                                </div>
                                            </div>
                                        </label>
                                        <select
                                            value={sensitivity}
                                            onChange={(e) => setSensitivity(e.target.value)}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
                                        >
                                            <option value="very_low">Very Low</option>
                                            <option value="low">Low</option>
                                            <option value="medium">Medium</option>
                                            <option value="high">High</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-xs text-neutral-400 block mb-1.5 flex items-center gap-1.5">
                                            Loudness percentile (70-90)
                                            <div className="group relative">
                                                <FaCircleInfo className="text-neutral-600 hover:text-neutral-400 cursor-help transition-colors" />
                                                <div className="absolute left-0 top-full mt-1 w-64 bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-lg">
                                                    Loudness threshold for beat detection. Range 70-90 recommended. Higher values = fewer markers, only louder beats detected.
                                                </div>
                                            </div>
                                        </label>
                                        <input
                                            type="number"
                                            value={loudness}
                                            onChange={(e) => setLoudness(Number(e.target.value))}
                                            min={70}
                                            max={90}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-xs text-neutral-400 block mb-1.5 flex items-center gap-1.5">
                                            Minimum gap (seconds)
                                            <div className="group relative">
                                                <FaCircleInfo className="text-neutral-600 hover:text-neutral-400 cursor-help transition-colors" />
                                                <div className="absolute left-0 top-full mt-1 w-64 bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-lg">
                                                    Minimum time between markers. Range 0.5-2.0 seconds recommended. Prevents marking beats too close together.
                                                </div>
                                            </div>
                                        </label>
                                        <input
                                            type="number"
                                            value={minGap}
                                            onChange={(e) => setMinGap(Number(e.target.value))}
                                            step={0.1}
                                            min={0.5}
                                            max={2.0}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
                                        />
                                    </div>

                                    <div className="flex items-center gap-2 pt-2">
                                        <input
                                            type="checkbox"
                                            id="beats-only"
                                            checked={beatsOnly}
                                            onChange={(e) => setBeatsOnly(e.target.checked)}
                                            className="w-4 h-4 rounded border-neutral-700 bg-neutral-800"
                                        />
                                        <label htmlFor="beats-only" className="text-xs text-neutral-400 flex items-center gap-1.5">
                                            Beats only (no onset detection)
                                            <div className="group relative">
                                                <FaCircleInfo className="text-neutral-600 hover:text-neutral-400 cursor-help transition-colors" />
                                                <div className="absolute left-0 top-full mt-1 w-64 bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-lg">
                                                    Use only beat tracking without onset detection. Simpler detection method focused on rhythmic beats.
                                                </div>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Output Options */}
                        <div>
                            <div
                                onClick={() => setOutputExpanded(!outputExpanded)}
                                className="flex items-center justify-between mb-3 cursor-pointer group"
                            >
                                <h2 className="text-sm font-medium text-neutral-300 group-hover:text-neutral-200 transition-colors">
                                    Output Options
                                </h2>
                                <div className="flex items-center gap-2 mb-3">
                                    {!outputExpanded && (
                                        <span className="hidden md:block text-xs text-neutral-500">
                                            Color: {markerColor} · Name: {markerName}{includeTimestamps ? ' · With timestamps' : ''}
                                        </span>
                                    )}
                                    {outputExpanded ? (
                                        <FaChevronUp className="text-neutral-500 text-xs" />
                                    ) : (
                                        <FaChevronDown className="text-neutral-500 text-xs" />
                                    )}
                                </div>
                            </div>

                            {outputExpanded && (
                                <div className="mb-5 space-y-4 bg-neutral-900 rounded-lg p-4 border border-neutral-800">
                                    <div>
                                        <label className="text-xs text-neutral-400 block mb-1.5 flex items-center gap-1.5">
                                            Marker color
                                            <div className="group relative">
                                                <FaCircleInfo className="text-neutral-600 hover:text-neutral-400 cursor-help transition-colors" />
                                                <div className="absolute left-0 top-full mt-1 w-64 bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-lg">
                                                    Color of markers in your video editing software (Premiere Pro, DaVinci Resolve, etc.)
                                                </div>
                                            </div>
                                        </label>
                                        <select
                                            value={markerColor}
                                            onChange={(e) => setMarkerColor(e.target.value)}
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
                                        >
                                            <option value="red">Red</option>
                                            <option value="blue">Blue</option>
                                            <option value="green">Green</option>
                                            <option value="yellow">Yellow</option>
                                            <option value="purple">Purple</option>
                                            <option value="cyan">Cyan</option>
                                            <option value="magenta">Magenta</option>
                                            <option value="orange">Orange</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-xs text-neutral-400 block mb-1.5 flex items-center gap-1.5">
                                            Marker name prefix
                                            <div className="group relative">
                                                <FaCircleInfo className="text-neutral-600 hover:text-neutral-400 cursor-help transition-colors" />
                                                <div className="absolute left-0 top-full mt-1 w-64 bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-lg">
                                                    Prefix for marker names. Example: "Beat" results in "Beat 1", "Beat 2", etc.
                                                </div>
                                            </div>
                                        </label>
                                        <input
                                            type="text"
                                            value={markerName}
                                            onChange={(e) => setMarkerName(e.target.value)}
                                            placeholder="Beat"
                                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-sm text-neutral-200 focus:outline-none focus:border-neutral-600"
                                        />
                                    </div>

                                    <div className="flex items-center gap-2 pt-2">
                                        <input
                                            type="checkbox"
                                            id="include-timestamps"
                                            checked={includeTimestamps}
                                            onChange={(e) => setIncludeTimestamps(e.target.checked)}
                                            className="w-4 h-4 rounded border-neutral-700 bg-neutral-800"
                                        />
                                        <label htmlFor="include-timestamps" className="text-xs text-neutral-400 flex items-center gap-1.5">
                                            Include timestamps in marker names
                                            <div className="group relative">
                                                <FaCircleInfo className="text-neutral-600 hover:text-neutral-400 cursor-help transition-colors" />
                                                <div className="absolute left-0 top-full mt-1 w-64 bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-lg">
                                                    Add timestamp to marker name. Example: "Beat 1 [00:05.234]"
                                                </div>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Column - Results & History */}
                    <div>
                        <div className="flex items-center justify-between mt-6 md:mt-0 mb-3">
                            <h2 className="text-sm font-medium text-neutral-300">Results & History</h2>
                            <div className="text-xs text-neutral-500">
                                Files are deleted every June 1st and Dec 1st to manage storage.
                            </div>
                        </div>

                        <div className="space-y-3">
                            {results.map((result) => (
                                <div key={result.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
                                    <div className="flex items-start justify-between mb-3">
                                        <div className="flex-1">
                                            <p className="text-sm text-neutral-200 font-medium">{result.fileName}</p>
                                            <p className="text-xs text-neutral-500 mt-0.5">
                                                {new Date(result.timestamp).toLocaleString()}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteResult(result.id)}
                                            className="text-neutral-500 hover:text-red-400 transition-colors ml-2"
                                            title="Delete result"
                                        >
                                            <FaTrash className="text-sm" />
                                        </button>
                                    </div>

                                    <div className="text-xs text-neutral-500 mb-3 space-y-0.5">
                                        <p>FPS: {result.settings.fps} · Sensitivity: {result.settings.sensitivity} · Loudness: {result.settings.loudness} · Min Gap: {result.settings.minGap}s</p>
                                        {result.settings.beatsOnly && <p>Mode: Beats only</p>}
                                        {result.settings.markerColor && <p>Marker: {result.settings.markerColor} · {result.settings.markerName || 'Beat'}</p>}
                                        {result.beatsCount !== undefined && <p>Beats detected: {result.beatsCount}</p>}
                                        {result.duration !== undefined && <p>Duration: {result.duration.toFixed(1)}s</p>}
                                        {result.avgSpacing !== undefined && <p>Avg spacing: {result.avgSpacing.toFixed(2)}s</p>}
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleDownload(result.beatsUrl, `${result.fileName}_beats.txt`)}
                                            className="cursor-pointer hover:bg-white hover:text-black flex-1 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-750 text-neutral-300 text-xs py-2 px-3 rounded transition-colors"
                                        >
                                            <FaDownload className="text-xs" />
                                            beats.txt
                                        </button>
                                        <button
                                            onClick={() => handleDownload(result.markersUrl, `${result.fileName}_markers.edl`)}
                                            className="cursor-pointer hover:bg-white hover:text-black flex-1 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-750 text-neutral-300 text-xs py-2 px-3 rounded transition-colors"
                                        >
                                            <FaDownload className="text-xs" />
                                            markers.edl
                                        </button>
                                    </div>
                                </div>
                            ))}

                            {results.length === 0 && queueItems.length === 0 && (
                                <div className="text-center flex items-center justify-center flex-col py-15 bg-neutral-900 rounded text-neutral-600">
                                    <FaCat className="text-3xl w-fit mb-2" />
                                    <p className="text-sm">No results yet</p>
                                    <p className="text-xs mt-1">When you upload an audio file, the results will appear here.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
            <div className="absolute bottom-5 right-5 px-4 py-2 text-white bg-neutral-800 flex items-center gap-2 rounded text-sm cursor-pointer" onClick={() => setIsModalOpen(true)}><FaHelicopter /> Help & Info</div>
            <InfoModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </div>
    );
}