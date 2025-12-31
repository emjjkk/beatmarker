// InfoModal.tsx
import { useState } from 'react';
import { FaX } from 'react-icons/fa6';

interface InfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'recommendations' | 'faqs' | 'about' | 'changelog';

export default function InfoModal({ isOpen, onClose }: InfoModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('recommendations');

  if (!isOpen) return null;

  const tabs: { id: TabType; label: string }[] = [
    { id: 'recommendations', label: 'Recommendations' },
    { id: 'faqs', label: 'FAQs' },
    { id: 'about', label: 'About' },
    { id: 'changelog', label: 'Changelog' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-700">
          <h2 className="text-xl font-semibold text-white">Information</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <FaX className="w-5 h-5 text-neutral-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-700 px-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-blue-400'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'recommendations' && <RecommendationsTab />}
          {activeTab === 'faqs' && <FAQsTab />}
          {activeTab === 'about' && <AboutTab />}
          {activeTab === 'changelog' && <ChangelogTab />}
        </div>
      </div>
    </div>
  );
}

function RecommendationsTab() {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-base font-semibold text-white mb-2">
          Getting the Best Results
        </h3>
        <div className="space-y-3">
          <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-3">
            <h4 className="font-medium text-blue-300 mb-1.5 text-sm">Audio Quality</h4>
            <p className="text-xs text-neutral-300">
              Use high-quality audio files (WAV, FLAC, or high-bitrate MP3) for
              best beat detection accuracy. Lower quality files may result in
              missed or false detections.
            </p>
          </div>

          <div className="bg-green-900/30 border border-green-700/50 rounded-lg p-3">
            <h4 className="font-medium text-green-300 mb-1.5 text-sm">
              Sensitivity Settings
            </h4>
            <ul className="text-xs text-neutral-300 space-y-0.5 list-disc list-inside">
              <li><strong>Very Low:</strong> Only the strongest beats</li>
              <li><strong>Low:</strong> Primary beats and accents (recommended)</li>
              <li><strong>Medium:</strong> Most musical events</li>
              <li><strong>High:</strong> All transients and subtle changes</li>
            </ul>
          </div>

          <div className="bg-purple-900/30 border border-purple-700/50 rounded-lg p-3">
            <h4 className="font-medium text-purple-300 mb-1.5 text-sm">
              Minimum Gap Spacing
            </h4>
            <p className="text-xs text-neutral-300">
              Set to 0.5s for most music. Increase to 1.0s+ for slower songs or
              to reduce marker density. Decrease to 0.25s for fast-paced
              electronic music.
            </p>
          </div>

          <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3">
            <h4 className="font-medium text-amber-300 mb-1.5 text-sm">
              Loudness Filtering
            </h4>
            <p className="text-xs text-neutral-300">
              The loudness percentile (default 70%) filters out quieter beats.
              Lower values include more markers, higher values keep only the
              loudest events.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function FAQsTab() {
  const faqs = [
    {
      q: 'What file formats are supported?',
      a: 'BeatMarker supports common audio formats including MP3, WAV, FLAC, AAC, OGG, and M4A. Maximum file size is 50MB.',
    },
    {
      q: 'What is the difference between beats and onsets?',
      a: 'Beats are the regular rhythmic pulses in music (like a metronome), while onsets detect any sudden change in audio energy (like drum hits, vocals, or instrumental attacks). Combining both gives more comprehensive markers.',
    },
    {
      q: 'I uploaded my .edl file but don\'t see markers in my video editor. What do I do?',
      a: 'Make sure your timeline frame rate matches the one selected during export. Also, check your video editor\'s import settings to ensure EDL files are supported and properly interpreted. Lastly, make sure your timeline starts at 00:00:00:00.',
    },
    {
      q: 'Can I customize marker colors and names?',
      a: 'Yes! You can choose from 8 different marker colors (red, blue, green, yellow, purple, cyan, magenta, orange) and set a custom name prefix for your markers.',
    },
    {
      q: 'Why are some beats missed?',
      a: 'Beat detection accuracy depends on audio quality, musical complexity, and settings. Try adjusting sensitivity, lowering the loudness threshold, or reducing minimum gap spacing.',
    },
    {
      q: 'Is my audio file stored on the server?',
      a: 'No. Audio files are processed in memory and immediately deleted. Only the generated marker files and metadata are stored for your download history.',
    },
  ];

  return (
    <div className="space-y-3">
      {faqs.map((faq, idx) => (
        <div key={idx} className="border border-neutral-700 rounded-lg p-3 bg-neutral-800/50">
          <h4 className="font-semibold text-white mb-1.5 text-sm">{faq.q}</h4>
          <p className="text-xs text-neutral-300">{faq.a}</p>
        </div>
      ))}
    </div>
  );
}

function AboutTab() {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-base font-semibold text-white mb-2">
          About BeatMarker
        </h3>
        <p className="text-xs text-neutral-300 leading-relaxed mb-3">
          BeatMarker is a powerful audio analysis tool designed for video
          editors, music producers, and content creators. It automatically
          detects beats and musical events in your audio files and generates
          precise markers for seamless integration with professional video
          editing software.
        </p>
        <p className="text-xs text-neutral-300 leading-relaxed">
          Built with Essentia audio analysis library and Flask backend,
          BeatMarker combines advanced beat tracking algorithms with onset
          detection to provide comprehensive rhythmic analysis of your music.
        </p>
      </section>

      <section className="border-t border-neutral-700 pt-4">
        <h3 className="text-base font-semibold text-white mb-2">
          Technology Stack
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-neutral-800/50 rounded-lg p-3">
            <h4 className="font-medium text-white mb-1.5 text-sm">Backend</h4>
            <ul className="text-xs text-neutral-300 space-y-0.5">
              <li>• Flask (Python)</li>
              <li>• Essentia Audio Analysis Python Library</li>
              <li>• Supabase Storage & Auth</li>
            </ul>
          </div>
          <div className="bg-neutral-800/50 rounded-lg p-3">
            <h4 className="font-medium text-white mb-1.5 text-sm">Frontend</h4>
            <ul className="text-xs text-neutral-300 space-y-0.5">
              <li>• Next.js 14</li>
              <li>• TypeScript</li>
              <li>• Tailwind CSS</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="border-t border-neutral-700 pt-4">
        <h3 className="text-base font-semibold text-white mb-2">Features</h3>
        <ul className="space-y-1.5 text-neutral-300">
          <li className="flex items-start text-xs">
            <span className="text-blue-400 mr-2">✓</span>
            <span>Advanced beat tracking and onset detection</span>
          </li>
          <li className="flex items-start text-xs">
            <span className="text-blue-400 mr-2">✓</span>
            <span>Customizable sensitivity and filtering options</span>
          </li>
          <li className="flex items-start text-xs">
            <span className="text-blue-400 mr-2">✓</span>
            <span>EDL marker export for video editing software</span>
          </li>
          <li className="flex items-start text-xs">
            <span className="text-blue-400 mr-2">✓</span>
            <span>Processing history and file management</span>
          </li>
          <li className="flex items-start text-xs">
            <span className="text-blue-400 mr-2">✓</span>
            <span>Custom marker colors and naming</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function ChangelogTab() {
  const changes = [
    {
      version: 'v1.0.0',
      date: '2023-12-01',
      changes: [
        'Initial release',
        'Beat and onset detection',
        'EDL marker export',
        'User authentication',
        'Processing history',
      ],
    },
  ];

  return (
    <div className="space-y-4">
      {changes.map((release, idx) => (
        <div key={idx} className="border-l-4 border-blue-500 pl-3">
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-base font-semibold text-white">
              {release.version}
            </h3>
            <span className="text-xs text-neutral-400">{release.date}</span>
          </div>
          <ul className="space-y-0.5">
            {release.changes.map((change, cidx) => (
              <li key={cidx} className="text-xs text-neutral-300 flex items-start">
                <span className="text-blue-400 mr-2">•</span>
                <span>{change}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}