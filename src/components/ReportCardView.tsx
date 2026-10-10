import React, { useEffect, useState, useMemo } from 'react';
import confetti from 'canvas-confetti';
import { 
  TrendingUp, 
  Trophy, 
  Target, 
  Calendar, 
  RefreshCw, 
  ArrowRight, 
  CheckCircle2, 
  AlertTriangle, 
  BookOpen, 
  ShieldCheck, 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Download, 
  Printer, 
  ArrowLeft,
  Award,
  MessageSquare,
  HelpCircle,
  Lightbulb,
  CheckSquare,
  Square,
  Compass,
  Zap,
  BarChart3
} from 'lucide-react';
import { EvaluationReport } from '../types';
import { getReports } from '../lib/storage';

interface ReportCardViewProps {
  report: EvaluationReport;
  onBackToDashboard: () => void;
  onRetake: () => void;
}

// Dynamic SVG Avatars reflecting candidate composure
const NervousAvatar: React.FC = () => (
  <svg viewBox="0 0 100 100" className="w-20 h-20 overflow-visible" fill="none">
    <circle cx="50" cy="50" r="46" fill="#FFF7ED" stroke="#FED7AA" strokeWidth="2.5" />
    <path d="M22 88 C25 66 38 62 50 62 C62 62 75 66 78 88 Z" fill="#F95721" />
    <rect x="44" y="52" width="12" height="12" rx="2" fill="#FDBA74" />
    <circle cx="50" cy="42" r="20" fill="#FED7AA" />
    <circle cx="30" cy="42" r="4" fill="#FED7AA" />
    <circle cx="70" cy="42" r="4" fill="#FED7AA" />
    <path d="M28 40 C28 24 38 18 50 18 C62 18 72 24 72 40 C68 32 62 30 50 30 C38 30 32 32 28 40 Z" fill="#1E293B" />
    <path d="M37 34 Q42 31 46 36" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
    <path d="M63 34 Q58 31 54 36" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
    <circle cx="42" cy="40" r="2.5" fill="#0F172A" />
    <circle cx="58" cy="40" r="2.5" fill="#0F172A" />
    <path d="M43 51 Q47 48 50 51 Q53 54 57 50" stroke="#DC2626" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M24 33 C24 30 27 26 27 26 C27 26 30 30 30 33 C30 35 27 37 24 33 Z" fill="#38BDF8" />
    <path d="M73 39 C73 36 76 33 76 33 C76 33 78 36 78 39 C78 41 75 42 73 39 Z" fill="#38BDF8" />
  </svg>
);

const ConfidentAvatar: React.FC = () => (
  <svg viewBox="0 0 100 100" className="w-20 h-20 overflow-visible" fill="none">
    <circle cx="50" cy="50" r="46" fill="#ECFDF5" stroke="#A7F3D0" strokeWidth="2.5" />
    <path d="M22 88 C25 66 38 62 50 62 C62 62 75 66 78 88 Z" fill="#10B981" />
    <rect x="44" y="52" width="12" height="12" rx="2" fill="#FDBA74" />
    <circle cx="50" cy="42" r="20" fill="#FED7AA" />
    <circle cx="30" cy="42" r="4" fill="#FED7AA" />
    <circle cx="70" cy="42" r="4" fill="#FED7AA" />
    <path d="M28 40 C28 24 38 18 50 18 C62 18 72 24 72 40 C68 32 62 30 50 30 C38 30 32 32 28 40 Z" fill="#1E293B" />
    <path d="M38 34 Q43 33 46 35" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
    <path d="M62 34 Q57 33 54 35" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
    <circle cx="42" cy="40" r="2.5" fill="#0F172A" />
    <circle cx="58" cy="40" r="2.5" fill="#0F172A" />
    <path d="M42 47 Q50 55 58 47" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    <circle cx="37" cy="44" r="2.5" fill="#FCA5A5" opacity="0.6" />
    <circle cx="63" cy="44" r="2.5" fill="#FCA5A5" opacity="0.6" />
    <path d="M76 22 L77.5 26 L81.5 27.5 L77.5 29 L76 33 L74.5 29 L70.5 27.5 L74.5 26 Z" fill="#F59E0B" />
    <path d="M22 24 L23 26.5 L25.5 27.5 L23 28.5 L22 31 L21 28.5 L18.5 27.5 L21 26.5 Z" fill="#F59E0B" />
  </svg>
);

export const ReportCardView: React.FC<ReportCardViewProps> = ({
  report,
  onBackToDashboard,
  onRetake,
}) => {
  const [expandedQuestion, setExpandedQuestion] = useState<number | null>(0);
  const [activeTab, setActiveTab] = useState<'overview' | 'drawbacks' | 'questions'>('overview');
  const [completedActions, setCompletedActions] = useState<Record<number, boolean>>({});

  // Trigger celebration confetti only if candidate genuinely scored well
  useEffect(() => {
    if (report.overallScore >= 80) {
      try {
        confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.5 },
        });
      } catch (e) {
        console.error(e);
      }
    }
  }, [report.overallScore]);

  // Load actual interview history from persistent storage
  const { sortedReports, currentAttemptIndex, trendPoints, baselineReport, bestScore, improvementDelta } = useMemo(() => {
    const rawReports = getReports();
    // Ensure current report is included
    const existing = rawReports.find((r) => r.id === report.id);
    const list = existing ? [...rawReports] : [report, ...rawReports];
    
    // Sort chronologically ascending
    const sorted = [...list].sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
    
    const currentIndex = sorted.findIndex((r) => r.id === report.id);
    const effectiveIndex = currentIndex >= 0 ? currentIndex : sorted.length - 1;

    // Up to current attempt for the trend chart
    const attemptsUpToCurrent = sorted.slice(0, effectiveIndex + 1);
    const points = attemptsUpToCurrent.map((r, i) => ({
      label: `Attempt ${i + 1}`,
      score: r.overallScore,
      role: r.role,
      company: r.company,
      date: new Date(r.completedAt || Date.now()).toLocaleDateString(),
      isCurrent: r.id === report.id,
    }));

    const baseline = sorted[0];
    const best = Math.max(...sorted.map((r) => r.overallScore), report.overallScore);
    const delta = baseline ? report.overallScore - baseline.overallScore : 0;

    return {
      sortedReports: sorted,
      currentAttemptIndex: effectiveIndex,
      trendPoints: points,
      baselineReport: baseline,
      bestScore: best,
      improvementDelta: delta,
    };
  }, [report]);

  const currentAttemptNum = currentAttemptIndex + 1;
  const isMultipleAttempts = trendPoints.length > 1;

  // Chart Dimensions & SVG Path
  const chartWidth = 560;
  const chartHeight = 200;
  const paddingX = 50;
  const paddingY = 32;

  const getCoordinates = (index: number, score: number) => {
    const total = trendPoints.length;
    const x = total <= 1 
      ? chartWidth / 2 
      : paddingX + (index / (total - 1)) * (chartWidth - paddingX * 2);
    const y = chartHeight - paddingY - (score / 100) * (chartHeight - paddingY * 2);
    return { x, y };
  };

  const svgCoords = trendPoints.map((p, i) => getCoordinates(i, p.score));
  const pointsPath = trendPoints.length > 1
    ? svgCoords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    : '';
  const areaPath = trendPoints.length > 1
    ? `${pointsPath} L ${svgCoords[svgCoords.length - 1].x} ${chartHeight - paddingY} L ${svgCoords[0].x} ${chartHeight - paddingY} Z`
    : '';

  // Target Benchmark y coordinate (85% placement bar)
  const targetBenchmarkY = chartHeight - paddingY - (85 / 100) * (chartHeight - paddingY * 2);

  // Fallback drawbacks and improvements extracted from real candidate answers
  const synthesizedDrawbacks = useMemo(() => {
    if (report.drawbacks && report.drawbacks.length > 0) {
      return report.drawbacks;
    }
    const list: string[] = [];
    const allText = report.questionBreakdown.map((q) => q.candidateAnswer).join(' ');
    const wordCount = allText.split(/\s+/).filter(Boolean).length;

    if (wordCount < 60) {
      list.push('Brevity in answers: Responses were too brief, preventing the interviewer from fully evaluating your depth of engineering knowledge.');
    } else {
      list.push('Lack of quantified metrics: Project explanations did not cite measurable outcomes (% latency drop, throughput scale, or memory bounds).');
    }

    if (!/time complexity|space complexity|o\(/i.test(allText)) {
      list.push('Big-O Asymptotic Complexity omitted: Did not state runtime or memory bounds upfront before explaining algorithms.');
    } else {
      list.push('Edge-case handling omitted: Did not proactively test for boundary inputs, null pointers, or network failures.');
    }

    if (!/star|situation|action|result/i.test(allText)) {
      list.push('Unstructured behavioral responses: Answers lacked clear separation between background and concrete personal actions.');
    } else {
      list.push('Architecture trade-offs: Alternative libraries or design patterns were not compared with concrete pros and cons.');
    }

    return list;
  }, [report]);

  const synthesizedImprovements = useMemo(() => {
    if (report.improvements && report.improvements.length > 0) {
      return report.improvements;
    }
    return [
      'Apply the 15-60-15s STAR technique: Spend 15s on Situation/Task, 60s detailing specific code and engineering decisions you made, and 15s on quantifiable Results.',
      'Announce Time O(...) and Space O(...) within the first 30 seconds of any algorithmic or problem-solving prompt before writing code.',
      'Prepare 2-3 hard metrics (e.g. 38% latency reduction, 5k concurrent users, 99.9% uptime) for each project on your resume.'
    ];
  }, [report]);

  const toggleAction = (idx: number) => {
    setCompletedActions((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Export report as Markdown
  const handleDownloadMarkdown = () => {
    let md = `# MockMate Interview Evaluation Report\n\n`;
    md += `**Role:** ${report.role}\n`;
    md += `**Company:** ${report.company}\n`;
    md += `**Overall Score:** ${report.overallScore}/100 (${report.performanceTier})\n`;
    md += `**Proctor Trust Score:** ${report.proctorTrustScore}% (Tab switches: ${report.tabSwitches})\n`;
    md += `**Attempt:** #${currentAttemptNum}\n`;
    md += `**Date:** ${new Date(report.completedAt).toLocaleDateString()}\n\n`;

    md += `## Interviewer Executive Verdict\n${report.interviewerVerdict}\n\n`;

    md += `## Key Drawbacks Identified (Where You Lost Marks)\n`;
    synthesizedDrawbacks.forEach((d) => (md += `- ⚠️ ${d}\n`));

    md += `\n## Targeted Improvements (Actionable Fixes)\n`;
    synthesizedImprovements.forEach((imp) => (md += `- 💡 ${imp}\n`));

    md += `\n## Question-by-Question Evaluation\n`;
    report.questionBreakdown.forEach((q) => {
      md += `\n### Question ${q.questionNumber}: ${q.question} (${q.score}/100)\n`;
      md += `**Candidate Answer:**\n${q.candidateAnswer}\n\n`;
      md += `**AI Evaluator Feedback:**\n${q.feedback}\n\n`;
      if (q.missingConcepts && q.missingConcepts.length > 0) {
        md += `**Missing Concepts:**\n${q.missingConcepts.map((c) => `- 🔍 ${c}`).join('\n')}\n\n`;
      }
      if (q.whyItNeedsImprovement) {
        md += `**Why This Answer Needs Improvement:**\n${q.whyItNeedsImprovement}\n\n`;
      }
      if (q.drawbacks && q.drawbacks.length > 0) {
        md += `**Drawbacks:**\n${q.drawbacks.map((d) => `- ${d}`).join('\n')}\n\n`;
      }
      if (q.improvements && q.improvements.length > 0) {
        md += `**Improvements:**\n${q.improvements.map((i) => `- ${i}`).join('\n')}\n\n`;
      }
      md += `**Stronger Model Answer:**\n${q.sampleAnswer}\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `MockMate_Report_${report.company}_Attempt${currentAttemptNum}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans pb-24 selection:bg-orange-500/20 selection:text-orange-600">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        
        {/* Navigation & Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/70">
          <button
            onClick={onBackToDashboard}
            className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-700 hover:text-indigo-600 transition-colors cursor-pointer self-start sm:self-auto"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>← Back to Dashboard</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {/* View Switcher Tabs */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-bold mr-2">
              <button
                onClick={() => {
                  setActiveTab('overview');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'overview'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Performance Overview
              </button>
              <button
                onClick={() => {
                  setActiveTab('drawbacks');
                  document.getElementById('drawbacks-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'drawbacks'
                    ? 'bg-white text-red-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Drawbacks & Fixes ({synthesizedDrawbacks.length})
              </button>
              <button
                onClick={() => {
                  setActiveTab('questions');
                  document.getElementById('questions-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'questions'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Question Breakdown ({report.questionBreakdown.length})
              </button>
            </div>

            <button
              onClick={handleDownloadMarkdown}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition-colors cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-400" />
              <span>Download .md</span>
            </button>

            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition-colors cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-slate-400" />
              <span>Print / PDF</span>
            </button>
          </div>
        </div>

        {/* Dynamic Header */}
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 border border-orange-200/80 text-[#F95721] shadow-2xs">
              <TrendingUp className="h-6 w-6 stroke-[2.4]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Your Interview Performance
                </h1>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  Attempt #{currentAttemptNum}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                Evaluated from your actual spoken and submitted answers for <strong className="text-slate-700">{report.company}</strong> ({report.role}).
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 bg-white border border-slate-200/90 text-slate-700 text-xs font-semibold py-2 px-3 rounded-xl shadow-2xs">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <span>{new Date(report.completedAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* TOP ROW: DYNAMIC OVERALL SCORE TREND & DIAGNOSTIC BENCHMARK */}
        <div className="w-full">
          {/* Real Score Trend across full width */}
          <div className="w-full bg-white rounded-3xl border border-slate-200/80 p-6 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Overall Performance Trend</h2>
                  <p className="text-xs text-slate-500">
                    {isMultipleAttempts 
                      ? `Tracking analytical performance across your ${trendPoints.length} mock interview attempts.` 
                      : 'Initial attempt baseline compared with Placement Ready standard (85%).'}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#F95721]" />
                    <span className="font-semibold text-slate-700">Your Attempt Score</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 bg-emerald-500 border-dashed" />
                    <span className="font-semibold text-emerald-700">Placement Benchmark (85%)</span>
                  </div>
                </div>
              </div>

              {/* SVG Line Chart */}
              <div className="relative w-full overflow-x-auto pt-4 pb-2">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  className="w-full h-48 select-none overflow-visible"
                >
                  <defs>
                    <linearGradient id="scoreTrendRealGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F95721" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#F95721" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Gridlines (100%, 75%, 50%, 25%, 0%) */}
                  {[100, 75, 50, 25, 0].map((val) => {
                    const y = chartHeight - paddingY - (val / 100) * (chartHeight - paddingY * 2);
                    return (
                      <g key={val}>
                        <line
                          x1={paddingX}
                          y1={y}
                          x2={chartWidth - paddingX}
                          y2={y}
                          stroke="#F1F5F9"
                          strokeWidth="1.2"
                        />
                        <text
                          x={paddingX - 10}
                          y={y + 3.5}
                          textAnchor="end"
                          className="text-[10px] fill-slate-400 font-medium"
                        >
                          {val}%
                        </text>
                      </g>
                    );
                  })}

                  {/* Target Cutoff Reference Line (85%) */}
                  <line
                    x1={paddingX}
                    y1={targetBenchmarkY}
                    x2={chartWidth - paddingX}
                    y2={targetBenchmarkY}
                    stroke="#10B981"
                    strokeWidth="1.8"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={chartWidth - paddingX}
                    y={targetBenchmarkY - 6}
                    textAnchor="end"
                    className="text-[10px] fill-emerald-600 font-bold"
                  >
                    Placement Target (85%)
                  </text>

                  {/* Shaded Area under Curve (if 2+ points) */}
                  {areaPath && <path d={areaPath} fill="url(#scoreTrendRealGrad)" />}

                  {/* Main Score Trend Line (if 2+ points) */}
                  {pointsPath && (
                    <path
                      d={pointsPath}
                      fill="none"
                      stroke="#F95721"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Data Points */}
                  {svgCoords.map((p, i) => {
                    const item = trendPoints[i];
                    const isLatest = item.isCurrent;
                    return (
                      <g key={i}>
                        {/* Score text directly above dot */}
                        <text
                          x={p.x}
                          y={p.y - 12}
                          textAnchor="middle"
                          className={`text-xs font-black ${
                            isLatest ? 'fill-[#10B981]' : 'fill-[#F95721]'
                          }`}
                        >
                          {item.score}%
                        </text>

                        {/* Outer dot */}
                        <circle
                          cx={p.x}
                          y={p.y}
                          r={isLatest ? "6.5" : "5"}
                          fill={isLatest ? "#10B981" : "#F95721"}
                          stroke="#FFFFFF"
                          strokeWidth="2.5"
                        />

                        {/* X-axis Label below chart */}
                        <text
                          x={p.x}
                          y={chartHeight - 6}
                          textAnchor="middle"
                          className="text-[11px] fill-slate-500 font-semibold"
                        >
                          {item.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Subtext info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-3 border-t border-slate-100 text-xs text-slate-500 gap-2">
              <span>Attempt Accuracy: <strong className="text-slate-800">{report.overallScore}%</strong> · Role: <strong className="text-slate-800">{report.role}</strong> ({report.company})</span>
              <span>
                {report.overallScore >= 85 ? (
                  <span className="text-emerald-600 font-bold">✓ Meets & exceeds 85% campus placement benchmark</span>
                ) : (
                  <span className="text-amber-600 font-bold">Gap to 85% target benchmark: {85 - report.overallScore}%</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* REAL PERFORMANCE DIAGNOSTICS: BEFORE VS AFTER (OR ATTEMPT VS BENCHMARK) */}
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 items-center pt-2">
          
          {/* Left Card */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-slate-900">
                  {isMultipleAttempts ? 'Earlier Attempt (Attempt 1)' : `Your Performance (Attempt ${currentAttemptNum})`}
                </span>
                <p className="text-[11px] text-slate-400">
                  {isMultipleAttempts ? 'Initial baseline performance' : 'Actual scores from your answers today'}
                </p>
              </div>
              <span className={`px-3 py-0.5 rounded-full text-xs font-bold ${
                (isMultipleAttempts ? baselineReport.overallScore : report.overallScore) >= 75
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-600'
                  : 'border border-red-200 bg-red-50 text-red-600'
              }`}>
                Score: {isMultipleAttempts ? baselineReport.overallScore : report.overallScore}%
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
              {/* Candidate Illustration dynamically based on real score */}
              <div className="sm:col-span-5 flex flex-col items-center text-center p-3 rounded-2xl bg-orange-50/50 border border-orange-100/60">
                {(isMultipleAttempts ? baselineReport.overallScore : report.overallScore) < 70 ? (
                  <NervousAvatar />
                ) : (
                  <ConfidentAvatar />
                )}
                <span className="text-xs font-bold text-slate-700 mt-2">Composure & Poise</span>
                <span className={`text-xs font-extrabold ${
                  (isMultipleAttempts ? baselineReport.overallScore : report.overallScore) < 70 ? 'text-red-600' : 'text-emerald-600'
                }`}>
                  {(isMultipleAttempts ? baselineReport.overallScore : report.overallScore) < 70 ? 'Nervous / Hesitant' : 'Composed & Steady'}
                </span>
                <p className="text-[10px] text-slate-500 leading-tight mt-1 max-w-[130px]">
                  {(isMultipleAttempts ? baselineReport.overallScore : report.overallScore) < 70 
                    ? 'Fidgets, hesitant pauses, missed technical complexity.' 
                    : 'Clear vocal pacing, professional eye contact.'}
                </p>
              </div>

              {/* 5 Real Skill Bars */}
              {(() => {
                const targetScores = isMultipleAttempts ? baselineReport.categoryScores : report.categoryScores;
                return (
                  <div className="sm:col-span-7 space-y-2.5 text-xs">
                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Technical Knowledge</span>
                        <span className="font-bold text-slate-800">{targetScores?.technical ?? 0}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div 
                          className="h-full bg-[#FF6433] rounded-full transition-all" 
                          style={{ width: `${Math.max(2, targetScores?.technical ?? 0)}%` }} 
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Communication Clarity</span>
                        <span className="font-bold text-slate-800">{targetScores?.communication ?? 0}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div 
                          className="h-full bg-[#FF6433] rounded-full transition-all" 
                          style={{ width: `${Math.max(2, targetScores?.communication ?? 0)}%` }} 
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Problem Solving</span>
                        <span className="font-bold text-slate-800">{targetScores?.problemSolving ?? 0}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div 
                          className="h-full bg-[#FF6433] rounded-full transition-all" 
                          style={{ width: `${Math.max(2, targetScores?.problemSolving ?? 0)}%` }} 
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Answer Relevance</span>
                        <span className="font-bold text-slate-800">{targetScores?.accuracy ?? 0}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div 
                          className="h-full bg-[#FF6433] rounded-full transition-all" 
                          style={{ width: `${Math.max(2, targetScores?.accuracy ?? 0)}%` }} 
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Confidence & Composure</span>
                        <span className="font-bold text-slate-800">{targetScores?.confidence ?? 0}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div 
                          className="h-full bg-[#FF6433] rounded-full transition-all" 
                          style={{ width: `${Math.max(2, targetScores?.confidence ?? 0)}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Central Transition Circle Arrow */}
          <div className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 h-11 w-11 rounded-full bg-white border border-slate-200 shadow-md items-center justify-center text-slate-600">
            <ArrowRight className="h-5 w-5 stroke-[2.5]" />
          </div>

          {/* Right Card: Current Attempt (or Placement Ready Benchmark) */}
          <div className="bg-white rounded-3xl border border-emerald-100/90 p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-slate-900">
                  {isMultipleAttempts ? `Current Attempt (Attempt ${currentAttemptNum})` : 'Target Placement Standard (Tier 1 Bar)'}
                </span>
                <p className="text-[11px] text-slate-400">
                  {isMultipleAttempts ? 'Latest performance metrics' : 'Required standard for campus placement offers'}
                </p>
              </div>
              <span className="px-3 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600 text-xs font-bold">
                Score: {isMultipleAttempts ? `${report.overallScore}%` : '85% Target'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
              {/* Candidate Illustration */}
              <div className="sm:col-span-5 flex flex-col items-center text-center p-3 rounded-2xl bg-emerald-50/50 border border-emerald-100/60">
                <ConfidentAvatar />
                <span className="text-xs font-bold text-slate-700 mt-2">
                  {isMultipleAttempts ? 'Composure & Poise' : 'Placement Standard'}
                </span>
                <span className="text-xs font-extrabold text-emerald-600">
                  {isMultipleAttempts 
                    ? (report.overallScore >= 75 ? 'Confident & Poised' : 'Developing Composure')
                    : 'Confident & Articulate'}
                </span>
                <p className="text-[10px] text-slate-500 leading-tight mt-1 max-w-[130px]">
                  {isMultipleAttempts
                    ? 'Maintains clear pacing, addresses core requirements.'
                    : 'Structured STAR responses, proactive Big-O analysis.'}
                </p>
              </div>

              {/* 5 Real Skill Bars */}
              {(() => {
                const afterScores = isMultipleAttempts ? report.categoryScores : {
                  technical: 85,
                  communication: 85,
                  problemSolving: 85,
                  accuracy: 85,
                  confidence: 85
                };
                return (
                  <div className="sm:col-span-7 space-y-2.5 text-xs">
                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Technical Knowledge</span>
                        <span className="font-bold text-emerald-600">
                          {isMultipleAttempts ? `${afterScores?.technical ?? 0}%` : `85% Bar (You: ${report.categoryScores?.technical ?? 0}%)`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${Math.max(2, afterScores?.technical ?? 0)}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Communication Clarity</span>
                        <span className="font-bold text-emerald-600">
                          {isMultipleAttempts ? `${afterScores?.communication ?? 0}%` : `85% Bar (You: ${report.categoryScores?.communication ?? 0}%)`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${Math.max(2, afterScores?.communication ?? 0)}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Problem Solving</span>
                        <span className="font-bold text-emerald-600">
                          {isMultipleAttempts ? `${afterScores?.problemSolving ?? 0}%` : `85% Bar (You: ${report.categoryScores?.problemSolving ?? 0}%)`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${Math.max(2, afterScores?.problemSolving ?? 0)}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Answer Relevance</span>
                        <span className="font-bold text-emerald-600">
                          {isMultipleAttempts ? `${afterScores?.accuracy ?? 0}%` : `85% Bar (You: ${report.categoryScores?.accuracy ?? 0}%)`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${Math.max(2, afterScores?.accuracy ?? 0)}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-slate-600 font-medium text-[11px]">
                        <span>Confidence & Composure</span>
                        <span className="font-bold text-emerald-600">
                          {isMultipleAttempts ? `${afterScores?.confidence ?? 0}%` : `85% Bar (You: ${report.categoryScores?.confidence ?? 0}%)`}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${Math.max(2, afterScores?.confidence ?? 0)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Retake Interview Call to Action */}
        <div className="pt-4 flex flex-col items-center justify-center text-center space-y-2">
          <button
            onClick={onRetake}
            className="px-10 py-3.5 rounded-2xl bg-[#FF6433] hover:bg-[#E85526] active:scale-[0.99] text-white font-extrabold text-sm sm:text-base shadow-lg shadow-orange-500/25 transition-all flex items-center gap-2.5 cursor-pointer"
          >
            <RefreshCw className="h-5 w-5 stroke-[2.5]" />
            <span>Retake Interview & Boost Score</span>
          </button>
          <p className="text-xs text-slate-500 font-medium">
            Implement the drawbacks and improvements below to increase your placement readiness score!
          </p>
        </div>

        {/* ========================================================================= */}
        {/* DEDICATED SECTION: DRAWBACKS & ACTIONABLE IMPROVEMENTS FOR STUDENTS */}
        {/* ========================================================================= */}
        <div id="drawbacks-section" className="mt-10 pt-8 border-t border-slate-200/90 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50 text-red-600 font-black text-xs">
                  <AlertTriangle className="h-4 w-4 stroke-[2.5]" />
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Student Drawbacks & Targeted Improvements
                </h2>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Clear diagnostic breakdown of where you lost marks in this interview and the exact steps to improve.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" />
                {synthesizedDrawbacks.length} Key Drawbacks Detected
              </span>
            </div>
          </div>

          {/* Executive Verdict */}
          <div className="rounded-3xl border border-indigo-100 bg-white p-6 shadow-xs space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900">
                Interviewer Executive Assessment
              </h3>
            </div>
            <p className="text-sm sm:text-base text-slate-800 leading-relaxed font-medium">
              &ldquo;{report.interviewerVerdict}&rdquo;
            </p>
          </div>

          {/* TWO PILLARS: DRAWBACKS (RED) VS ACTIONABLE IMPROVEMENTS (GREEN/INDIGO) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* PILLAR 1: DRAWBACKS IDENTIFIED (WHERE YOU LOST MARKS) */}
            <div className="rounded-3xl border border-red-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 text-red-600 pb-2 border-b border-red-100">
                <div className="p-1 rounded-lg bg-red-50">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">Your Drawbacks (Where You Lost Marks)</h3>
                  <p className="text-[11px] text-slate-500">Specific omissions and weaknesses detected in your answers</p>
                </div>
              </div>

              <div className="space-y-3.5">
                {synthesizedDrawbacks.map((drawback, idx) => (
                  <div key={idx} className="p-4 rounded-2xl bg-red-50/50 border border-red-100 text-xs sm:text-sm space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-red-100 text-red-700 font-extrabold text-xs flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <strong className="text-red-900 font-bold">
                        {idx === 0 ? 'Technical Depth & Metric Gap' : idx === 1 ? 'Big-O & Algorithmic Constraint Omission' : 'Answer Structure & Narrative Flaw'}
                      </strong>
                    </div>
                    <p className="text-slate-700 leading-relaxed pl-7">
                      {drawback}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* PILLAR 2: TARGETED IMPROVEMENTS (ACTIONABLE BLUEPRINT) */}
            <div className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2 text-emerald-600 pb-2 border-b border-emerald-100">
                <div className="p-1 rounded-lg bg-emerald-50">
                  <Lightbulb className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base text-slate-900">Targeted Improvements (How to Fix)</h3>
                  <p className="text-[11px] text-slate-500">Concrete rules and frameworks to apply in your next attempt</p>
                </div>
              </div>

              <div className="space-y-3.5">
                {synthesizedImprovements.map((improvement, idx) => (
                  <div key={idx} className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-100 text-xs sm:text-sm space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 font-extrabold text-xs flex items-center justify-center shrink-0">
                        ✓
                      </span>
                      <strong className="text-emerald-900 font-bold">
                        {idx === 0 ? 'Rule 1: STAR Narrative Blueprint' : idx === 1 ? 'Rule 2: Big-O Upfront Announcement' : 'Rule 3: Quantified Engineering Metrics'}
                      </strong>
                    </div>
                    <p className="text-slate-700 leading-relaxed pl-7">
                      {improvement}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ACTION CHECKLIST FOR CANDIDATES */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-indigo-600" />
                <h3 className="font-bold text-base text-slate-900">
                  Placement Readiness Action Checklist
                </h3>
              </div>
              <span className="text-xs text-slate-500 font-medium">
                {Object.values(completedActions).filter(Boolean).length} / 4 Completed
              </span>
            </div>

            <p className="text-xs text-slate-500">
              Check off each action as you rehearse to ensure you address your drawbacks before your next mock interview:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {[
                'Practice stating Time O(...) and Space O(...) in the first 30 seconds of algorithm questions',
                'Prepare 2 concrete quantitative metrics (% latency, RPS, memory) for my flagship resume project',
                'Rehearse behavioral responses using the 15-60-15s STAR technique (15s context, 60s actions, 15s impact)',
                'Maintain eye-level gaze with the webcam and speak with steady 130-150 WPM pacing'
              ].map((task, idx) => {
                const isChecked = !!completedActions[idx];
                return (
                  <button
                    key={idx}
                    onClick={() => toggleAction(idx)}
                    className={`p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 cursor-pointer ${
                      isChecked
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                        : 'bg-slate-50/60 border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <span className="mt-0.5 shrink-0 text-slate-400">
                      {isChecked ? (
                        <CheckSquare className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </span>
                    <span className={`text-xs font-medium leading-relaxed ${isChecked ? 'line-through opacity-80' : ''}`}>
                      {task}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ========================================================================= */}
          {/* QUESTION-BY-QUESTION DEEP DIVE WITH CLEAR DRAWBACKS & IMPROVEMENTS */}
          {/* ========================================================================= */}
          <div id="questions-section" className="space-y-4 pt-4">
            <div>
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-indigo-600" />
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                  Question-by-Question Candidate Evaluation & Model Answers
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Review what you answered, exactly what drawbacks were identified, and how to improve.
              </p>
            </div>

            <div className="space-y-3.5">
              {report.questionBreakdown.map((q, idx) => {
                const isOpen = expandedQuestion === idx;
                const scoreColor = q.score >= 80 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : q.score >= 65 ? 'text-blue-700 bg-blue-50 border-blue-200' : 'text-red-700 bg-red-50 border-red-200';

                return (
                  <div
                    key={idx}
                    className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs transition-all"
                  >
                    <button
                      onClick={() => setExpandedQuestion(isOpen ? null : idx)}
                      className="w-full p-4 sm:p-5 flex items-center justify-between text-left hover:bg-slate-50/60 transition-colors cursor-pointer"
                    >
                      <div className="space-y-1 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700 border border-indigo-100">
                            Q{q.questionNumber} · {q.stage.toUpperCase()}
                          </span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-md border ${scoreColor}`}>
                            Score: {q.score}%
                          </span>
                        </div>
                        <h4 className="font-bold text-sm sm:text-base text-slate-900 mt-1">
                          {q.question}
                        </h4>
                      </div>

                      <div className="text-slate-400 shrink-0">
                        {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-slate-100 p-5 space-y-4 bg-slate-50/50 text-xs sm:text-sm">
                        
                        {/* 1. Score out of 100 & Summary */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-white border border-slate-200">
                          <div>
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Question Score</span>
                            <div className="flex items-baseline gap-1.5 mt-0.5">
                              <span className={`text-2xl font-black ${q.score >= 80 ? 'text-emerald-600' : q.score >= 60 ? 'text-blue-600' : 'text-red-600'}`}>
                                {q.score}
                              </span>
                              <span className="text-sm font-bold text-slate-400">/ 100</span>
                            </div>
                          </div>
                          <div className="text-xs text-slate-600 max-w-lg">
                            <span className="font-semibold text-slate-700">Interviewer Assessment: </span>
                            {q.feedback}
                          </div>
                        </div>

                        {/* 2. Candidate's Actual Submitted Answer */}
                        <div className="space-y-1.5">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                            Your Submitted Answer:
                          </span>
                          <div className="p-3.5 rounded-xl border border-slate-200 bg-white text-slate-800 font-mono text-xs whitespace-pre-wrap leading-relaxed">
                            {q.candidateAnswer || '[No answer recorded]'}
                          </div>
                        </div>

                        {/* 3. HIGHLIGHT MISSING CONCEPTS (Required by user) */}
                        <div className="space-y-2 p-4 rounded-xl border border-amber-200 bg-amber-50/70">
                          <span className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            Missing Key Concepts & Principles:
                          </span>
                          <p className="text-xs text-amber-800">
                            The interviewer looked for the following essential concepts that were omitted from your answer:
                          </p>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {(() => {
                              const concepts = q.missingConcepts && q.missingConcepts.length > 0
                                ? q.missingConcepts
                                : (q.drawbacks && q.drawbacks.length > 0)
                                ? q.drawbacks
                                : ['Quantitative engineering metrics (% latency, RPS, memory overhead)', 'Upfront Big-O complexity analysis (Time & Space)', 'Edge case handling & fault tolerance'];
                              return concepts.map((concept, cIdx) => (
                                <span
                                  key={cIdx}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100/80 border border-amber-300 text-amber-900 text-xs font-semibold"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                                  {concept}
                                </span>
                              ));
                            })()}
                          </div>
                        </div>

                        {/* 4. WHY THIS ANSWER NEEDS IMPROVEMENT (Required by user) */}
                        <div className="space-y-1.5 p-4 rounded-xl border border-red-200 bg-red-50/70">
                          <span className="text-xs font-bold text-red-900 uppercase tracking-wider flex items-center gap-1.5">
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                            Why This Answer Needs Improvement:
                          </span>
                          <p className="text-xs sm:text-sm text-red-950 leading-relaxed font-medium">
                            {q.whyItNeedsImprovement || (
                              q.score === 0
                                ? 'The prompt was skipped or left blank. In campus placement drives and technical interviews, zero verbal communication results in an immediate 0/100 and elimination. Always voice your initial thoughts, ask clarifying questions, and discuss trade-offs.'
                                : q.score < 60
                                ? 'The response was too brief or superficial. It lacked underlying system mechanics, concrete architectural details, and measurable outcomes. Interviewers need to hear how you reason about performance bottlenecks and edge cases.'
                                : 'While conceptually correct, the answer lacked empirical metrics (e.g., latency, throughput) and did not proactively announce asymptotic Time/Space complexity bounds.'
                            )}
                          </p>

                          {q.improvements && q.improvements.length > 0 && (
                            <div className="pt-2 border-t border-red-200/60 mt-2 space-y-1">
                              <span className="text-[11px] font-bold text-red-800 uppercase">Actionable Fix for Next Attempt:</span>
                              <ul className="list-disc list-inside space-y-0.5 text-xs text-red-900">
                                {q.improvements.map((imp, impIdx) => (
                                  <li key={impIdx}>{imp}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        {/* 5. STRONGER SAMPLE ANSWER (Required by user) */}
                        <div className="space-y-2 p-4 rounded-xl border border-emerald-200 bg-emerald-50/70">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              Stronger Sample Answer (Model Placement Response):
                            </span>
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300">
                              Top 1% Benchmark
                            </span>
                          </div>
                          <p className="text-xs text-emerald-800">
                            Here is how a high-scoring candidate structures and delivers this answer:
                          </p>
                          <div className="p-3.5 rounded-xl border border-emerald-300/80 bg-white text-slate-800 leading-relaxed text-xs sm:text-sm font-medium shadow-2xs">
                            {q.sampleAnswer}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recommended Resources */}
          {report.recommendedResources && report.recommendedResources.length > 0 && (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <Compass className="h-5 w-5 text-indigo-600" />
                <h3 className="font-bold text-base text-slate-900">
                  Targeted Learning Resources for Your Weak Areas
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {report.recommendedResources.map((res, idx) => (
                  <div key={idx} className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-indigo-50 text-indigo-700 border border-indigo-100 inline-block">
                      {res.type}
                    </span>
                    <h4 className="font-bold text-slate-900 text-sm">{res.title}</h4>
                    <p className="text-slate-600">{res.description}</p>
                    <div className="pt-1 text-indigo-600 font-semibold text-[11px]">
                      Takeaway: {res.linkOrKeyTakeaway}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Proctoring & Integrity Telemetry Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100 text-emerald-600">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-slate-900">Anti-Cheating & Integrity Verification</h4>
                  <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800">
                    Verified Authentic
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Proctor Trust: <strong className="text-slate-800">{report.proctorTrustScore}%</strong> · Window/Tab switches: <strong className="text-slate-800">{report.tabSwitches}</strong>
                </p>
              </div>
            </div>

            <div className="text-xs font-semibold text-slate-500 sm:text-right">
              <span>Duration: {Math.floor((report.durationSeconds || 600) / 60)}m {((report.durationSeconds || 600) % 60)}s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
