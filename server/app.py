import os
import uuid
import tempfile
import json
import numpy as np
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
from celery import Celery
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

# Redis/Celery Configuration
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379/0')
app.config['CELERY_BROKER_URL'] = REDIS_URL
app.config['CELERY_RESULT_BACKEND'] = REDIS_URL

# Initialize Celery
celery = Celery(app.name, broker=app.config['CELERY_BROKER_URL'])
celery.conf.update(app.config)

# Supabase setup
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# JWT Secret
JWT_SECRET = os.getenv('SUPABASE_JWT_SECRET')

# Marker color codes for EDL (common video editing software colors)
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

# ------------------ Celery Tasks ------------------
@celery.task(bind=True)
def process_audio_task(self, audio_path, settings, user_id, file_name, processing_id):
    """Background task to process audio"""
    try:
        # Update task state
        self.update_state(state='PROGRESS', meta={'progress': 10})
        
        # Load audio file
        loader = MonoLoader(filename=audio_path)
        audio = loader()
        sample_rate = loader.paramValue('sampleRate')
        duration = len(audio) / sample_rate

        self.update_state(state='PROGRESS', meta={'progress': 30})

        # Detect beats
        beats = detect_beats(audio)
        
        # Detect onsets if needed
        if not settings['beatsOnly']:
            onsets = detect_onsets(audio, sample_rate, settings['sensitivity'])
            combined = snap_onsets_to_beats(beats, onsets)
        else:
            combined = beats

        self.update_state(state='PROGRESS', meta={'progress': 60})

        # Filter by loudness
        filtered = filter_by_loudness(audio, combined, sample_rate, settings['loudness'])
        
        # Apply smart spacing
        final_times = smart_spacing(filtered, settings['minGap'])
        
        # Calculate statistics
        stats = calculate_statistics(final_times)

        self.update_state(state='PROGRESS', meta={'progress': 80})

        # Create output files
        timestamp = datetime.utcnow().isoformat() + 'Z'
        
        # Create beats text file
        beats_content = "\n".join([format_timestamp(t) for t in final_times])
        beats_filename = f"{user_id}/{processing_id}_beats.txt"
        
        # Create EDL markers file
        edl_content = create_edl_markers(
            final_times, 
            fps=settings['fps'], 
            color=settings['markerColor'], 
            name_prefix=settings['markerName'],
            include_timestamps=settings['includeTimestamps']
        )
        edl_filename = f"{user_id}/{processing_id}_markers.edl"
        
        # Upload files to Supabase storage
        supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        
        supabase_client.storage.from_('beatmarker-files').upload(
            beats_filename,
            beats_content.encode('utf-8'),
            {'content-type': 'text/plain'}
        )
        
        supabase_client.storage.from_('beatmarker-files').upload(
            edl_filename,
            edl_content.encode('utf-8'),
            {'content-type': 'text/plain'}
        )
        
        # Get public URLs
        beats_url = supabase_client.storage.from_('beatmarker-files').get_public_url(beats_filename)
        markers_url = supabase_client.storage.from_('beatmarker-files').get_public_url(edl_filename)

        self.update_state(state='PROGRESS', meta={'progress': 95})

        # Save to database
        supabase_client.table('processing_history').insert({
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

        # Clean up temp file
        if os.path.exists(audio_path):
            os.remove(audio_path)

        return {
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

    except Exception as e:
        # Clean up on error
        if 'audio_path' in locals() and os.path.exists(audio_path):
            os.remove(audio_path)
        raise Exception(f'Processing failed: {str(e)}')

# ------------------ Flask Routes ------------------
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'}), 200

@app.route('/api/process', methods=['POST'])
@require_auth
def process_audio(user_id):
    """Queue audio file for processing"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    # Save file to temporary location
    file_ext = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp:
        file.save(tmp.name)
        temp_path = tmp.name

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

        processing_id = str(uuid.uuid4())

        # Queue the task
        task = process_audio_task.apply_async(
            args=[temp_path, settings, user_id, file.filename, processing_id]
        )

        return jsonify({
            'taskId': task.id,
            'processingId': processing_id,
            'status': 'queued'
        }), 202

    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return jsonify({'error': f'Failed to queue task: {str(e)}'}), 500

@app.route('/api/task/<task_id>', methods=['GET'])
@require_auth
def get_task_status(user_id, task_id):
    """Get the status of a processing task"""
    task = process_audio_task.AsyncResult(task_id)
    
    if task.state == 'PENDING':
        response = {
            'state': task.state,
            'status': 'Pending...'
        }
    elif task.state == 'PROGRESS':
        response = {
            'state': task.state,
            'progress': task.info.get('progress', 0),
            'status': 'Processing...'
        }
    elif task.state == 'SUCCESS':
        response = {
            'state': task.state,
            'result': task.info,
            'status': 'Complete'
        }
    else:
        # Task failed
        response = {
            'state': task.state,
            'status': str(task.info),
            'error': str(task.info)
        }
    
    return jsonify(response)

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