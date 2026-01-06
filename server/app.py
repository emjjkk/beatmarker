import os
import uuid
import tempfile
import json
import numpy as np
import threading
import time
from datetime import datetime
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import jwt
from functools import wraps
from dotenv import load_dotenv
from supabase import create_client, Client
from essentia.standard import (
    MonoLoader,
    FrameGenerator,
    Windowing,
    Spectrum,
    OnsetDetection,
    Onsets,
    BeatTrackerMultiFeature,
    Loudness
)
import io

load_dotenv()

app = Flask(__name__)

# CORS Configuration
CORS(
    app,
    resources={r"/*": {
        "origins": [
            "https://beatmarker.emjjkk.tech",
            "https://shiny-space-fortnight-7p4j9qr75x7h4j-3000.app.github.dev"
        ],
        "supports_credentials": True,
        "allow_headers": ["Content-Type", "Authorization"],
        "methods": ["GET", "POST", "OPTIONS", "DELETE"]
    }}
)

# Configuration
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size
app.config['UPLOAD_FOLDER'] = tempfile.gettempdir()

# Supabase setup
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# JWT Secret
JWT_SECRET = os.getenv('SUPABASE_JWT_SECRET')

# Queue processing interval (7 seconds)
QUEUE_PROCESS_INTERVAL = 7

# Marker color codes for EDL
MARKER_COLORS = {
    'red': '001',
    'blue': '002',
    'green': '003',
    'yellow': '004',
    'purple': '005',
    'cyan': '006',
    'magenta': '007',
    'orange': '008'
}

# ------------------ Authentication Middleware ------------------
def get_user_id_from_token():
    """Extract user_id from JWT token"""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    
    token = auth_header.split(' ')[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'], options={"verify_signature": False})
        return payload.get('sub')
    except jwt.InvalidTokenError:
        return None

def require_auth(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = get_user_id_from_token()
        if not user_id:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(user_id, *args, **kwargs)
    return decorated_function

# ------------------ Time utils ------------------
def format_timestamp(seconds, include_timestamp=True):
    """Format timestamp for beat file"""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds - int(seconds)) * 1000)
    return f"{minutes:02d}:{secs:02d}:{milliseconds:03d}"

def seconds_to_timecode(seconds, fps=30):
    """Convert seconds to SMPTE timecode"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    frames = int((seconds % 1) * fps)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}:{frames:02d}"

# ------------------ Core logic ------------------
def detect_beats(audio):
    """Detect beats in audio using Essentia"""
    tracker = BeatTrackerMultiFeature()
    beats, confidence = tracker(audio)
    return [float(b) for b in beats]

def detect_onsets(audio, sample_rate=44100, sensitivity='low'):
    """Detect onsets in audio"""
    frame_size = 2048
    hop_size = 512

    window = Windowing(type="hann")
    spectrum_alg = Spectrum()
    odf = OnsetDetection(method="hfc")
    onset_picker = Onsets()

    odf_values = []
    for frame in FrameGenerator(
        audio,
        frameSize=frame_size,
        hopSize=hop_size,
        startFromZero=True
    ):
        windowed = window(frame)
        spectrum = spectrum_alg(windowed)
        odf_values.append(odf(spectrum, spectrum))

    odf_array = np.array(odf_values)
    if len(odf_array) > 0 and odf_array.max() > 0:
        odf_array = odf_array / odf_array.max()
        
        thresholds = {
            'very_low': 0.6,
            'low': 0.4,
            'medium': 0.2,
            'high': 0.1
        }
        threshold = thresholds.get(sensitivity, 0.4)
        odf_array[odf_array < threshold] = 0

    odf_matrix = np.array([odf_array.tolist()])
    onset_times = onset_picker(odf_matrix, [hop_size / sample_rate])
    return [float(o) for o in onset_times]

def filter_by_loudness(audio, times, sample_rate=44100, percentile=70):
    """Filter detected times by loudness threshold"""
    frame_size = 4096
    hop_size = 2048
    
    loudness_alg = Loudness()
    loudness_values = []
    time_stamps = []
    
    for i, frame in enumerate(FrameGenerator(
        audio,
        frameSize=frame_size,
        hopSize=hop_size,
        startFromZero=True
    )):
        loudness_values.append(loudness_alg(frame))
        time_stamps.append(i * hop_size / sample_rate)
    
    threshold = np.percentile(loudness_values, percentile)
    
    filtered = []
    for t in times:
        idx = min(range(len(time_stamps)), key=lambda i: abs(time_stamps[i] - t))
        if loudness_values[idx] >= threshold:
            filtered.append(t)
    
    return filtered

def smart_spacing(times, min_gap=0.5):
    """Apply minimum spacing between detected times"""
    if not times:
        return []
    
    spaced = [times[0]]
    for t in times[1:]:
        if t - spaced[-1] >= min_gap:
            spaced.append(t)
    
    return spaced

def snap_onsets_to_beats(beats, onsets, snap_threshold=0.08):
    """Snap onsets to nearby beats"""
    snapped = set(beats)

    for onset in onsets:
        if not beats:
            snapped.add(onset)
            continue
        nearest_beat = min(beats, key=lambda b: abs(b - onset))
        if abs(nearest_beat - onset) <= snap_threshold:
            snapped.add(nearest_beat)
        else:
            snapped.add(onset)

    return sorted(snapped)

def create_edl_markers(times, fps=30, color='red', name_prefix='Beat', include_timestamps=True):
    """Create EDL marker file with custom colors and names"""
    lines = ["TITLE: Timeline Markers", "FCM: NON-DROP FRAME", ""]
    
    color_code = MARKER_COLORS.get(color.lower(), '001')

    for i, t in enumerate(times, 1):
        tc = seconds_to_timecode(t, fps)
        
        if include_timestamps:
            timestamp_str = format_timestamp(t)
            marker_name = f"{name_prefix} {i} [{timestamp_str}]"
        else:
            marker_name = f"{name_prefix} {i}"
        
        lines.append(f"{i:03d}  {color_code}      V     C        {tc} {tc} {tc} {tc}")
        lines.append(f"* FROM CLIP NAME: {marker_name}")
        lines.append(f"|M:{tc}|{marker_name}")
        lines.append("")

    return "\n".join(lines)

def calculate_statistics(times):
    """Calculate statistics about detected beats"""
    if len(times) < 2:
        return {
            'count': len(times),
            'avg_spacing': 0,
            'min_spacing': 0,
            'max_spacing': 0
        }
    
    spacings = [times[i+1] - times[i] for i in range(len(times)-1)]
    return {
        'count': len(times),
        'avg_spacing': sum(spacings) / len(spacings),
        'min_spacing': min(spacings),
        'max_spacing': max(spacings)
    }

# ------------------ Queue Processing Worker ------------------
def process_queue_item(queue_item):
    """Process a single queue item"""
    queue_id = queue_item['id']
    user_id = queue_item['user_id']
    file_name = queue_item['file_name']
    settings = queue_item['settings']
    
    try:
        # Update status to processing
        supabase.table('processing_queue').update({
            'status': 'processing',
            'started_at': datetime.utcnow().isoformat() + 'Z'
        }).eq('id', queue_id).execute()
        
        # Download file from storage (assuming it was uploaded to temp storage)
        temp_file_path = f"temp_uploads/{user_id}/{queue_id}"
        response = supabase.storage.from_('beatmarker-temp').download(temp_file_path)
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.audio') as tmp:
            tmp.write(response)
            temp_path = tmp.name
        
        try:
            # Extract settings
            fps = settings.get('fps', 30)
            sensitivity = settings.get('sensitivity', 'low')
            loudness_percentile = settings.get('loudness', 70)
            min_gap = settings.get('minGap', 0.5)
            beats_only = settings.get('beatsOnly', False)
            marker_color = settings.get('markerColor', 'red')
            marker_name = settings.get('markerName', 'Beat')
            include_timestamps = settings.get('includeTimestamps', True)

            # Load audio file
            loader = MonoLoader(filename=temp_path)
            audio = loader()
            sample_rate = loader.paramValue('sampleRate')
            duration = len(audio) / sample_rate

            # Detect beats
            beats = detect_beats(audio)
            
            # Detect onsets if needed
            if not beats_only:
                onsets = detect_onsets(audio, sample_rate, sensitivity)
                combined = snap_onsets_to_beats(beats, onsets)
            else:
                combined = beats

            # Filter by loudness
            filtered = filter_by_loudness(audio, combined, sample_rate, loudness_percentile)
            
            # Apply smart spacing
            final_times = smart_spacing(filtered, min_gap)
            
            # Calculate statistics
            stats = calculate_statistics(final_times)

            # Create output files
            processing_id = str(uuid.uuid4())
            timestamp = datetime.utcnow().isoformat() + 'Z'
            
            # Create beats text file
            beats_content = "\n".join([format_timestamp(t) for t in final_times])
            beats_filename = f"{user_id}/{processing_id}_beats.txt"
            
            # Create EDL markers file
            edl_content = create_edl_markers(
                final_times, 
                fps=fps, 
                color=marker_color, 
                name_prefix=marker_name,
                include_timestamps=include_timestamps
            )
            edl_filename = f"{user_id}/{processing_id}_markers.edl"
            
            # Upload files to Supabase storage
            supabase.storage.from_('beatmarker-files').upload(
                beats_filename,
                beats_content.encode('utf-8'),
                {'content-type': 'text/plain'}
            )
            
            supabase.storage.from_('beatmarker-files').upload(
                edl_filename,
                edl_content.encode('utf-8'),
                {'content-type': 'text/plain'}
            )
            
            # Get public URLs
            beats_url = supabase.storage.from_('beatmarker-files').get_public_url(beats_filename)
            markers_url = supabase.storage.from_('beatmarker-files').get_public_url(edl_filename)
            
            # Save to processing_history
            supabase.table('processing_history').insert({
                'id': processing_id,
                'user_id': user_id,
                'file_name': file_name,
                'settings': settings,
                'beats_url': beats_url,
                'markers_url': markers_url,
                'beats_count': stats['count'],
                'duration_seconds': duration,
                'avg_spacing': stats['avg_spacing'],
                'created_at': timestamp
            }).execute()

            # Update queue item with result
            result = {
                'id': processing_id,
                'fileName': file_name,
                'settings': settings,
                'timestamp': timestamp,
                'beatsUrl': beats_url,
                'markersUrl': markers_url,
                'beatsCount': stats['count'],
                'duration': duration,
                'avgSpacing': stats['avg_spacing'],
                'minSpacing': stats['min_spacing'],
                'maxSpacing': stats['max_spacing']
            }

            supabase.table('processing_queue').update({
                'status': 'completed',
                'result': result,
                'completed_at': datetime.utcnow().isoformat() + 'Z'
            }).eq('id', queue_id).execute()

        finally:
            # Clean up temp file
            if os.path.exists(temp_path):
                os.remove(temp_path)
            
            # Clean up temp upload
            try:
                supabase.storage.from_('beatmarker-temp').remove([temp_file_path])
            except:
                pass

    except Exception as e:
        print(f"Error processing queue item {queue_id}: {str(e)}")
        supabase.table('processing_queue').update({
            'status': 'failed',
            'error_message': str(e),
            'completed_at': datetime.utcnow().isoformat() + 'Z'
        }).eq('id', queue_id).execute()

def queue_worker():
    """Background worker to process queue items"""
    print("Queue worker started")
    while True:
        try:
            # Get next pending item
            response = supabase.table('processing_queue')\
                .select('*')\
                .eq('status', 'pending')\
                .order('created_at')\
                .limit(1)\
                .execute()
            
            if response.data:
                queue_item = response.data[0]
                print(f"Processing queue item: {queue_item['id']}")
                process_queue_item(queue_item)
            
            # Wait for interval before checking again
            time.sleep(QUEUE_PROCESS_INTERVAL)
            
        except Exception as e:
            print(f"Error in queue worker: {str(e)}")
            time.sleep(QUEUE_PROCESS_INTERVAL)

# Start queue worker in background thread
worker_thread = threading.Thread(target=queue_worker, daemon=True)
worker_thread.start()

# ------------------ Flask Routes ------------------
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'}), 200

@app.route('/api/queue/add', methods=['POST'])
@require_auth
def add_to_queue(user_id):
    """Add a file to the processing queue"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    try:
        # Extract settings from the form
        settings = {
            'fps': int(request.form.get('fps', 30)),
            'sensitivity': request.form.get('sensitivity', 'low'),
            'loudness': int(request.form.get('loudness', 70)),
            'minGap': float(request.form.get('minGap', 0.5)),
            'beatsOnly': request.form.get('beatsOnly', 'false').lower() == 'true',
            'markerColor': request.form.get('markerColor', 'red'),
            'markerName': request.form.get('markerName', 'Beat'),
            'includeTimestamps': request.form.get('includeTimestamps', 'true').lower() == 'true'
        }

        # Create queue ID
        queue_id = str(uuid.uuid4())
        
        # Upload file to temporary storage
        temp_file_path = f"temp_uploads/{user_id}/{queue_id}"
        file_content = file.read()
        supabase.storage.from_('beatmarker-temp').upload(
            temp_file_path,
            file_content,
            {'content-type': file.content_type or 'audio/mpeg'}
        )

        # Add to queue
        response = supabase.table('processing_queue').insert({
            'id': queue_id,
            'user_id': user_id,
            'file_name': file.filename,
            'settings': settings,
            'status': 'pending'
        }).execute()

        # Get queue position
        position_response = supabase.table('processing_queue')\
            .select('position')\
            .eq('id', queue_id)\
            .single()\
            .execute()

        return jsonify({
            'queueId': queue_id,
            'position': position_response.data['position'],
            'status': 'pending'
        }), 200

    except Exception as e:
        return jsonify({'error': f'Failed to add to queue: {str(e)}'}), 500

@app.route('/api/queue/status/<queue_id>', methods=['GET'])
@require_auth
def get_queue_status(user_id, queue_id):
    """Get status of a queue item"""
    try:
        response = supabase.table('processing_queue')\
            .select('*')\
            .eq('id', queue_id)\
            .eq('user_id', user_id)\
            .single()\
            .execute()

        if not response.data:
            return jsonify({'error': 'Queue item not found'}), 404

        queue_item = response.data
        return jsonify({
            'id': queue_item['id'],
            'status': queue_item['status'],
            'position': queue_item['position'],
            'result': queue_item.get('result'),
            'error': queue_item.get('error_message'),
            'createdAt': queue_item['created_at'],
            'startedAt': queue_item.get('started_at'),
            'completedAt': queue_item.get('completed_at')
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/queue/user', methods=['GET'])
@require_auth
def get_user_queue(user_id):
    """Get all queue items for a user"""
    try:
        response = supabase.table('processing_queue')\
            .select('*')\
            .eq('user_id', user_id)\
            .in_('status', ['pending', 'processing'])\
            .order('created_at')\
            .execute()

        items = []
        for item in response.data:
            items.append({
                'id': item['id'],
                'fileName': item['file_name'],
                'status': item['status'],
                'position': item['position'],
                'createdAt': item['created_at']
            })

        return jsonify(items), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/history', methods=['GET'])
@require_auth
def get_history(user_id):
    """Get user's processing history"""
    try:
        response = supabase.table('processing_history')\
            .select('*')\
            .eq('user_id', user_id)\
            .order('created_at', desc=True)\
            .execute()
        
        history = []
        for item in response.data:
            history.append({
                'id': item['id'],
                'fileName': item['file_name'],
                'settings': item['settings'],
                'timestamp': item['created_at'],
                'beatsUrl': item['beats_url'],
                'markersUrl': item['markers_url'],
                'beatsCount': item['beats_count'],
                'duration': item['duration_seconds'],
                'avgSpacing': item['avg_spacing']
            })
        
        return jsonify(history), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download/<path:filename>', methods=['GET'])
@require_auth
def download_file(user_id, filename):
    """Download a processed file"""
    try:
        if not filename.startswith(f"{user_id}/"):
            return jsonify({'error': 'Access denied'}), 403
        
        response = supabase.storage.from_('beatmarker-files').download(filename)
        
        temp_path = os.path.join(app.config['UPLOAD_FOLDER'], filename.split('/')[-1])
        with open(temp_path, 'wb') as f:
            f.write(response)
        
        return send_file(
            temp_path,
            as_attachment=True,
            download_name=filename.split('/')[-1]
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'temp_path' in locals() and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass

@app.route('/api/delete/<processing_id>', methods=['DELETE'])
@require_auth
def delete_processing(user_id, processing_id):
    """Delete a processing record and associated files"""
    try:
        response = supabase.table('processing_history')\
            .select('*')\
            .eq('id', processing_id)\
            .eq('user_id', user_id)\
            .execute()
        
        if not response.data:
            return jsonify({'error': 'Record not found or access denied'}), 404
        
        beats_filename = f"{user_id}/{processing_id}_beats.txt"
        edl_filename = f"{user_id}/{processing_id}_markers.edl"
        
        try:
            supabase.storage.from_('beatmarker-files').remove([beats_filename, edl_filename])
        except:
            pass
        
        supabase.table('processing_history')\
            .delete()\
            .eq('id', processing_id)\
            .execute()
        
        return jsonify({'message': 'Processing deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route("/keep-alive", methods=["GET"])
def keep_alive():
    return jsonify({"status": "alive"}), 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)