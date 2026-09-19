import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Sparkles, Check, RefreshCw } from 'lucide-react';
import { ClarityLogo } from '../components/Logos';
import { OnboardingPayload, UserProfiles, UserGoals } from './types';
import { getDefaultSkillRatings } from './data/skillTopics';
import { ProgressIndicator } from './components/ProgressIndicator';
import { ProfilesStep } from './steps/ProfilesStep';
import { SkillRatingsStep } from './steps/SkillRatingsStep';
import { GoalsStep } from './steps/GoalsStep';
import { GeneratingStep } from './steps/GeneratingStep';
import { generateKnowledgeGraph } from '../lib/graph/generate';
import { ONBOARDING_TOPIC_CATALOG } from '../lib/graph/catalog';

const STORAGE_KEY = 'clarity_onboarding_draft';
const COMPLETED_KEY = 'clarity_completed_profile';

const INITIAL_PROFILES: UserProfiles = {
  leetcode: '',
  codeforces: '',
  gfg: '',
  github: '',
  hackerrank: '',
  codechef: '',
};

const INITIAL_GOALS: UserGoals = {
  dreamCompany: 'Google',
  targetRole: 'sde',
  placementTimeline: 'autumn-winter-2026',
};

const STEP_LABELS = [
  'Coding Profiles',
  'Skill Confidence',
  'Goals & Timeline',
];

export const OnboardingFlow: React.FC = () => {
  const navigate = useNavigate();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [maxReachedStep, setMaxReachedStep] = useState<number>(1);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Form state
  const [profiles, setProfiles] = useState<UserProfiles>(INITIAL_PROFILES);
  const [skillRatings, setSkillRatings] = useState<Record<string, number>>(() => getDefaultSkillRatings());
  const [goals, setGoals] = useState<UserGoals>(INITIAL_GOALS);

  // 1. Rehydrate from localStorage on initial mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<OnboardingPayload> & { currentStep?: number; maxReachedStep?: number };
        if (parsed.profiles) setProfiles(parsed.profiles);
        if (parsed.skillRatings) setSkillRatings(parsed.skillRatings);
        if (parsed.goals) setGoals(parsed.goals);
        if (parsed.currentStep && parsed.currentStep >= 1 && parsed.currentStep <= 3) {
          setCurrentStep(parsed.currentStep);
        }
        if (parsed.maxReachedStep) {
          setMaxReachedStep(parsed.maxReachedStep);
        }
        setLastSavedTime('Restored draft');
      }
    } catch {
      // LocalStorage fallback
    }
  }, []);

  // 2. Persist in-progress answers to localStorage on modification
  useEffect(() => {
    if (isGenerating) return;

    try {
      const payload: OnboardingPayload & { currentStep: number; maxReachedStep: number } = {
        profiles,
        skillRatings,
        goals,
        currentStep,
        maxReachedStep,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch {
      // Ignore quota errors
    }
  }, [profiles, skillRatings, goals, currentStep, maxReachedStep, isGenerating]);

  // Validation rules
  const isStep1Valid = useMemo(() => {
    return Object.values(profiles).some((val) => Boolean(val && val.trim().length > 0));
  }, [profiles]);

  const isStep2Valid = useMemo(() => {
    // Sliders are initialized with sensible defaults
    return Object.keys(skillRatings).length > 0;
  }, [skillRatings]);

  const isStep3Valid = useMemo(() => {
    return Boolean(goals.dreamCompany && goals.dreamCompany.trim().length > 0 && goals.placementTimeline);
  }, [goals]);

  const canProceed = useMemo(() => {
    if (currentStep === 1) return isStep1Valid;
    if (currentStep === 2) return isStep2Valid;
    if (currentStep === 3) return isStep3Valid;
    return false;
  }, [currentStep, isStep1Valid, isStep2Valid, isStep3Valid]);

  const validationHint = useMemo(() => {
    if (currentStep === 1 && !isStep1Valid) {
      return 'Enter at least one platform username or URL to proceed';
    }
    if (currentStep === 3 && !goals.dreamCompany.trim()) {
      return 'Specify your target company to continue';
    }
    return null;
  }, [currentStep, isStep1Valid, goals.dreamCompany]);

  // Navigation handlers
  const handleNext = () => {
    if (!canProceed) return;

    if (currentStep < 3) {
      setDirection('forward');
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      setMaxReachedStep((prev) => Math.max(prev, nextStep));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (currentStep === 3) {
      // Trigger Knowledge Graph generation
      setIsGenerating(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    if (currentStep > 1 && !isGenerating) {
      setDirection('backward');
      setCurrentStep((prev) => prev - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleStepJump = (targetStep: number) => {
    if (targetStep >= 1 && targetStep <= maxReachedStep && !isGenerating) {
      setDirection(targetStep > currentStep ? 'forward' : 'backward');
      setCurrentStep(targetStep);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Completion callback
  const handleGenerationComplete = (finalPayload: OnboardingPayload) => {
    const fullPayload: OnboardingPayload = {
      ...finalPayload,
      completedAt: new Date().toISOString(),
    };

    // Store completed profile & clear draft
    try {
      localStorage.setItem(COMPLETED_KEY, JSON.stringify(fullPayload));
      localStorage.removeItem(STORAGE_KEY);

      // Deterministically generate knowledge graph from onboarding ratings
      const graph = generateKnowledgeGraph({
        catalog: ONBOARDING_TOPIC_CATALOG,
        ratings: fullPayload.skillRatings,
        targetCompany: fullPayload.goals?.dreamCompany,
        timeline: fullPayload.goals?.placementTimeline,
      });
      localStorage.setItem('clarity_knowledge_graph', JSON.stringify(graph));
    } catch {
      // LocalStorage fallback
    }

    // Route to dashboard with welcome flag
    navigate('/dashboard?welcome=1');
  };

  // Transition variants
  const slideVariants = {
    enter: (dir: 'forward' | 'backward') => ({
      x: dir === 'forward' ? 24 : -24,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: 'forward' | 'backward') => ({
      x: dir === 'forward' ? -24 : 24,
      opacity: 0,
    }),
  };

  const currentPayload: OnboardingPayload = {
    profiles,
    skillRatings,
    goals,
  };

  return (
    <div className="min-h-screen bg-[#FAF6F0] text-[#1F2420] flex flex-col font-sans relative selection:bg-[#C1592B] selection:text-[#FAF6F0]">
      {/* Subtle, Restrained Ambient Glow Behind Wizard Card */}
      <div
        className="absolute top-0 left-0 right-0 h-[460px] pointer-events-none overflow-hidden z-0"
        aria-hidden="true"
      >
        <div
          className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[700px] sm:w-[900px] h-[340px] rounded-full"
          style={{
            background:
              'radial-gradient(ellipse at 50% 30%, rgba(249, 115, 22, 0.16) 0%, rgba(251, 146, 60, 0.09) 35%, rgba(91, 107, 77, 0.05) 65%, transparent 85%)',
            filter: 'blur(50px)',
          }}
        />
      </div>

      {/* Persistent Minimal Header */}
      <header className="w-full relative z-20 border-b border-[#1F2420]/8 bg-[#FAF6F0]/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Logo linking back to landing page */}
          <Link to="/" className="inline-block" title="Return to Clarity Home">
            <ClarityLogo className="scale-90 origin-left" />
          </Link>

          {/* Autosave status indicator */}
          <div className="flex items-center gap-3">
            {lastSavedTime && (
              <span className="text-[11.5px] font-mono text-[#1F2420]/50 hidden sm:inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#5B6B4D]" />
                <span>Autosaved</span>
              </span>
            )}
            <Link
              to="/"
              className="text-[13px] text-[#1F2420]/70 hover:text-[#C1592B] font-medium transition-colors"
            >
              Exit to Home
            </Link>
          </div>
        </div>
      </header>

      {/* Main Wizard Area */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-start relative z-10">
        {/* Progress Indicator (hidden while in generating animation) */}
        {!isGenerating && (
          <div className="mb-6 sm:mb-8">
            <ProgressIndicator
              currentStep={currentStep}
              totalSteps={3}
              stepLabels={STEP_LABELS}
              onStepClick={handleStepJump}
              maxReachedStep={maxReachedStep}
            />
          </div>
        )}

        {/* Live Accessibility Announcer for screen readers */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {isGenerating
            ? 'Generating Knowledge Graph'
            : `Step ${currentStep} of 3: ${STEP_LABELS[currentStep - 1]}`}
        </div>

        {/* Wizard Card Container */}
        <div
          className={`w-full rounded-[16px] bg-[#FBF9F5] border border-[#1F2420]/10 shadow-[0_8px_30px_rgba(40,35,25,0.05)] transition-all ${
            isGenerating ? 'p-4 sm:p-8' : 'p-5 sm:p-8 md:p-10'
          }`}
        >
          {isGenerating ? (
            <GeneratingStep
              payload={currentPayload}
              onComplete={handleGenerationComplete}
            />
          ) : (
            <div>
              {/* Step Content Container with Motion Transitions */}
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={currentStep}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  {currentStep === 1 && (
                    <ProfilesStep
                      profiles={profiles}
                      onChange={setProfiles}
                      isValid={isStep1Valid}
                    />
                  )}
                  {currentStep === 2 && (
                    <SkillRatingsStep
                      skillRatings={skillRatings}
                      onChange={setSkillRatings}
                    />
                  )}
                  {currentStep === 3 && (
                    <GoalsStep
                      goals={goals}
                      onChange={setGoals}
                    />
                  )}
                </motion.div>
              </AnimatePresence>

              {/* Wizard Footer Controls */}
              <div className="mt-8 sm:mt-10 pt-5 sm:pt-6 border-t border-[#1F2420]/10 flex flex-col sm:flex-row items-center justify-between gap-4">
                {/* Back Affordance */}
                <div>
                  {currentStep > 1 ? (
                    <button
                      type="button"
                      onClick={handleBack}
                      className="w-full sm:w-auto px-5 py-[11px] text-[14px] font-medium text-[#1F2420] bg-transparent border border-[#1F2420]/25 rounded-[4px] hover:bg-[#1F2420]/5 active:bg-[#1F2420]/10 transition-all duration-150 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Back</span>
                    </button>
                  ) : (
                    <span className="text-[12px] text-[#1F2420]/45 font-normal hidden sm:inline">
                      Step 1 of 3 · Platform sync
                    </span>
                  )}
                </div>

                {/* Validation Hint (Subtle, non-alarming) & Forward CTA */}
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                  {validationHint && (
                    <span className="text-[12px] text-[#C1592B] font-medium text-center sm:text-right">
                      {validationHint}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={handleNext}
                    disabled={!canProceed}
                    className="w-full sm:w-auto px-7 py-[12px] text-[14px] sm:text-[15px] font-medium text-[#FAF6F0] bg-[#1F2420] border border-[#1F2420] rounded-[4px] hover:bg-[#2e3730] active:bg-[#161a17] transition-all duration-150 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 select-none"
                  >
                    {currentStep === 3 ? (
                      <>
                        <Sparkles className="w-4 h-4 text-[#FAF6F0]" />
                        <span>Generate My Knowledge Graph</span>
                      </>
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Security & Data Footnote */}
        <div className="mt-6 text-center text-[12px] text-[#1F2420]/50">
          <span>Encrypted client-side session · Only public solve statistics are parsed</span>
        </div>
      </main>
    </div>
  );
};
