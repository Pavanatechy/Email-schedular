import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { emailService } from '../services/email.service';
import { useToast } from '../context/ToastContext';
import { Upload, Trash2, FileText, AlertCircle, Calendar, ShieldAlert } from 'lucide-react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FILE_SIZE_MB = 5;

export const Compose: React.FC = () => {
  const { addToast } = useToast();
  const navigate = useNavigate();

  // Form State
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [startTime, setStartTime] = useState(() => {
    // default to 2 mins from now locally
    const now = new Date(Date.now() + 2 * 60 * 1000);
    // Format to yyyy-MM-ddThh:mm for datetime-local value
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  });
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(200);

  // Leads State
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [stats, setStats] = useState<{ valid: number; duplicates: number; invalid: number } | null>(null);

  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateEmail = (email: string) => EMAIL_REGEX.test(email);

  const parseLeadsFile = (text: string, extension: string) => {
    let rawEmails: string[] = [];

    if (extension === 'csv') {
      const lines = text.split(/\r?\n/);
      if (lines.length === 0) return;
      
      // Look for the "email" column
      const headerLine = lines[0];
      const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());
      const emailIdx = headers.indexOf('email');

      if (emailIdx === -1) {
        addToast('No "email" column found in CSV header line.', 'error');
        return;
      }

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const columns = line.split(',');
        if (columns[emailIdx]) {
          rawEmails.push(columns[emailIdx].trim());
        }
      }
    } else {
      // txt format
      const lines = text.split(/\r?\n/);
      rawEmails = lines.map((l) => l.trim()).filter(Boolean);
    }

    // Process statistics
    let validCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;

    const seen = new Set<string>();
    const uniqueValid: string[] = [];

    rawEmails.forEach((raw) => {
      const email = raw.toLowerCase();
      if (!validateEmail(email)) {
        invalidCount++;
      } else if (seen.has(email)) {
        duplicateCount++;
      } else {
        seen.add(email);
        uniqueValid.push(raw); // preserve casing if needed, but lowercase for safety is standard
        validCount++;
      }
    });

    if (uniqueValid.length === 0) {
      addToast('No valid email addresses found in file.', 'error');
      return;
    }

    setRecipients(uniqueValid);
    setStats({ valid: validCount, duplicates: duplicateCount, invalid: invalidCount });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const processFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv' && ext !== 'txt') {
      addToast('Unsupported file type. Please upload a .csv or .txt file.', 'error');
      return;
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      addToast(`File exceeds limit of ${MAX_FILE_SIZE_MB} MB.`, 'error');
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseLeadsFile(text, ext);
    };
    reader.readAsText(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const removeFile = () => {
    setFileName(null);
    setRecipients([]);
    setStats(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const validateForm = () => {
    const tempErrors: Record<string, string> = {};

    if (!subject.trim()) {
      tempErrors.subject = 'Subject is required.';
    } else if (subject.length > 200) {
      tempErrors.subject = 'Subject cannot exceed 200 characters.';
    }

    if (!body.trim()) {
      tempErrors.body = 'Email body content is required.';
    }

    if (recipients.length === 0) {
      tempErrors.recipients = 'Please upload a CSV or TXT file containing recipients.';
    }

    if (!startTime) {
      tempErrors.startTime = 'Start time is required.';
    } else {
      const selectedDate = new Date(startTime);
      if (selectedDate.getTime() < Date.now() - 60000) { // allow 1 min leniency
        tempErrors.startTime = 'Start time must be in the future.';
      }
    }

    if (delaySeconds < 0) {
      tempErrors.delaySeconds = 'Delay must be a positive number or zero.';
    }

    if (hourlyLimit <= 0) {
      tempErrors.hourlyLimit = 'Hourly limit must be greater than zero.';
    }

    setErrors(tempErrors);
    return Object.keys(tempErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      addToast('Please correct form errors before proceeding.', 'error');
      return;
    }

    try {
      setLoading(true);
      // Convert local date picker string directly to a UTC ISO string
      const utcISO = new Date(startTime).toISOString();

      const res = await emailService.scheduleEmails({
        subject: subject.trim(),
        body: body.trim(),
        startTime: utcISO,
        delaySeconds,
        hourlyLimit,
        recipients,
      });

      if (res.success) {
        addToast(res.message || `${recipients.length} emails scheduled successfully`, 'success');
        navigate('/dashboard');
      } else {
        addToast(res.message || 'Scheduling failed', 'error');
      }
    } catch (err: any) {
      console.error(err);
      if (err.response?.data?.errors) {
        // Field-specific validation failures from the backend (Zod)
        const serverErrors: Record<string, string> = {};
        err.response.data.errors.forEach((e: any) => {
          serverErrors[e.field] = e.message;
        });
        setErrors(serverErrors);
        addToast('Validation failed on server.', 'error');
      } else {
        addToast(err.response?.data?.message || 'Error connecting to the API server.', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-24 md:pb-0">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold text-white">Compose New Email</h1>
        <p className="text-sm text-slate-400 mt-1">Configure recipient parsing, email content, and delivery limits.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side fields */}
        <div className="lg:col-span-2 space-y-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-6">
          {/* Section: Recipients */}
          <div className="space-y-3">
            <label className="block text-sm font-bold text-slate-200 uppercase tracking-wide">
              Recipients List
            </label>
            
            {!fileName ? (
              /* Drag Zone */
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition ${
                  dragActive
                    ? 'border-indigo-400 bg-indigo-500/5 text-indigo-300'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-950/40 text-slate-400 hover:text-slate-350'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".csv,.txt"
                  className="hidden"
                />
                <Upload className="h-8 w-8 mb-3" />
                <p className="text-sm font-bold text-slate-200">
                  Drag and drop your file here, or <span className="text-indigo-400 underline hover:text-indigo-300">browse</span>
                </p>
                <p className="text-xs text-slate-500 mt-2">
                  Supports CSV (with "email" column) or plain TXT (one email per line). Max {MAX_FILE_SIZE_MB}MB.
                </p>
              </div>
            ) : (
              /* File Upload Details */
              <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-800 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-500/10 text-indigo-400 p-2.5 rounded-lg border border-indigo-500/20">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white truncate max-w-xs">{fileName}</p>
                    {stats && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        <span className="text-indigo-400 font-bold">{stats.valid}</span> valid detected •{' '}
                        <span className="text-amber-400 font-semibold">{stats.duplicates}</span> duplicates removed •{' '}
                        <span className="text-rose-400 font-semibold">{stats.invalid}</span> invalid ignored
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeFile}
                  className="p-2 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-900 transition focus:outline-none"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            )}
            {errors.recipients && (
              <p className="text-xs text-rose-400 flex items-center gap-1.5 mt-1.5 font-medium">
                <AlertCircle className="h-3.5 w-3.5" />
                {errors.recipients}
              </p>
            )}
          </div>

          <hr className="border-slate-800/80" />

          {/* Section: Email content */}
          <div className="space-y-4">
            {/* Subject */}
            <div className="space-y-1.5">
              <label htmlFor="subject" className="block text-xs font-bold text-slate-400 uppercase tracking-wide">
                Email Subject
              </label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter campaign subject line..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 text-white placeholder-slate-650 transition"
              />
              {errors.subject && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5 mt-1.5 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.subject}
                </p>
              )}
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <label htmlFor="body" className="block text-xs font-bold text-slate-400 uppercase tracking-wide">
                Email Body
              </label>
              <textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder="Write your email body content here..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 text-white placeholder-slate-650 font-mono transition resize-y"
              />
              {errors.body && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5 mt-1.5 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.body}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Side Settings Panel */}
        <div className="space-y-6">
          {/* Scheduling Configuration Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide border-b border-slate-800 pb-3 flex items-center gap-2">
              <Calendar className="h-4.5 w-4.5 text-indigo-400" />
              Scheduling Setup
            </h3>

            {/* Start Time */}
            <div className="space-y-1.5">
              <label htmlFor="startTime" className="block text-xs font-semibold text-slate-400">
                Start Date & Time (Local)
              </label>
              <input
                id="startTime"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 text-white transition"
              />
              {errors.startTime && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5 mt-1 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.startTime}
                </p>
              )}
            </div>

            {/* Minimum Delay */}
            <div className="space-y-1.5">
              <label htmlFor="delaySeconds" className="block text-xs font-semibold text-slate-400">
                Min Send Delay (seconds)
              </label>
              <input
                id="delaySeconds"
                type="number"
                min={0}
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(parseInt(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 text-white transition"
              />
              <p className="text-[10px] text-slate-500 leading-normal">
                Minimum interval separating individual emails. Prevents concurrent worker spams.
              </p>
              {errors.delaySeconds && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5 mt-1 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.delaySeconds}
                </p>
              )}
            </div>

            {/* Hourly Limit */}
            <div className="space-y-1.5">
              <label htmlFor="hourlyLimit" className="block text-xs font-semibold text-slate-400">
                Hourly Quota Limit
              </label>
              <input
                id="hourlyLimit"
                type="number"
                min={1}
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(parseInt(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 text-white transition"
              />
              <p className="text-[10px] text-slate-500 leading-normal">
                Maximum emails allowed for this sender in any sliding hour window.
              </p>
              {errors.hourlyLimit && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5 mt-1 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {errors.hourlyLimit}
                </p>
              )}
            </div>
          </div>

          {/* Campaign Summary Checklist Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wide border-b border-slate-800 pb-3 flex items-center gap-2">
              <ShieldAlert className="h-4.5 w-4.5 text-indigo-400" />
              Campaign Review
            </h3>
            <div className="space-y-2 text-xs text-slate-400">
              <div className="flex justify-between py-1 border-b border-slate-850">
                <span>Leads Count:</span>
                <span className="font-bold text-slate-200">{recipients.length} recipients</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-850">
                <span>Start Time:</span>
                <span className="font-bold text-slate-200">
                  {startTime ? new Date(startTime).toLocaleString() : 'Not Set'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-850">
                <span>Worker Spacing:</span>
                <span className="font-bold text-slate-200">{delaySeconds}s delay</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Sender Quota:</span>
                <span className="font-bold text-slate-200">{hourlyLimit} emails/hour</span>
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="flex-1 bg-slate-800 hover:bg-slate-750 text-slate-300 font-bold py-2.5 px-4 rounded-xl border border-slate-750 transition text-sm text-center"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2.5 px-4 rounded-xl transition duration-200 disabled:opacity-50 text-sm shadow-md"
              >
                {loading ? 'Scheduling...' : 'Schedule Campaign'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
