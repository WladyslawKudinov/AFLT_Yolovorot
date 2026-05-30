import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight, X } from "lucide-react";

interface OnboardingStep {
  target: string;
  title: string;
  description: string;
  position: "top" | "bottom" | "left" | "right";
}

const onboardingSteps: OnboardingStep[] = [
  {
    target: "[data-onboarding='help-button']",
    title: "Помощь всегда рядом",
    description: "Нажмите на эту кнопку в любой момент, чтобы освежить знания о функциях приложения.",
    position: "bottom",
  },
  {
    target: "[data-onboarding='order-selector']",
    title: "Выбор наряд-заказа",
    description: "Здесь вы можете выбрать заказ для обработки. Кликните, чтобы увидеть список доступных наряд-заказов (аналог Workorder из ТОиР).",
    position: "bottom",
  },
  {
    target: "[data-onboarding='upload-button']",
    title: "Загрузка файлов",
    description: "Загружайте изображения инструментов с компьютера. Поддерживаются JPG, PNG и другие форматы.",
    position: "right",
  },
  {
    target: "[data-onboarding='camera-button']",
    title: "Запуск камер",
    description: "Запустите камеры для захвата изображений в реальном времени. Можно работать с несколькими камерами одновременно.",
    position: "right",
  },
  {
    target: "[data-onboarding='view-results-button']",
    title: "Просмотр результатов",
    description: "После успешной загрузки изображений на сервер вы сможете нажать эту кнопку для вывода результата.",
    position: "right",
  },
  {
    target: "[data-onboarding='display-format-toggle']",
    title: "Выбор формата показа",
    description: "По умолчанию инструменты будут обведены цветным контуром. Однако вы всегда можете выбрать обводку цветными рамками.",
    position: "right",
  },
  {
    target: "[data-onboarding='results-panel']",
    title: "Результаты",
    description: "Здесь отображаются распознанные инструменты. Вы можете выбрать отдельный инструмент, он выделится на фото и вы получите возможность пожаловаться на классификацию.",
    position: "left",
  },
  {
    target: "[data-onboarding='complete-button']",
    title: "Завершение",
    description: "Когда все готово, нажмите эту кнопку для завершения выдачи или сдачи инструментов.",
    position: "bottom",
  },
];

export function InteractiveOnboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem("hasSeenInteractiveOnboarding");
    const urlParams = new URLSearchParams(window.location.search);
    const shouldResetOnboarding = urlParams.has('resetOnboarding');
    
    if (!hasSeenOnboarding || shouldResetOnboarding) {
      // Clear URL parameter if present
      if (shouldResetOnboarding) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      
      // Wait for page to load
      setTimeout(() => {
        setIsActive(true);
      }, 1000);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;

    const updateTargetPosition = () => {
      const step = onboardingSteps[currentStep];
      const targetElement = document.querySelector(step.target);

      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        setTargetRect(rect);

        // Calculate tooltip position
        const tooltipWidth = 380;
        const tooltipHeight = 220;
        const spacing = 20;

        let top = 0;
        let left = 0;

        switch (step.position) {
          case "top":
            top = rect.top - tooltipHeight - spacing;
            left = rect.left + rect.width / 2 - tooltipWidth / 2;
            break;
          case "bottom":
            top = rect.bottom + spacing;
            left = rect.left + rect.width / 2 - tooltipWidth / 2;
            break;
          case "left":
            top = rect.top + rect.height / 2 - tooltipHeight / 2;
            left = rect.left - tooltipWidth - spacing;
            break;
          case "right":
            top = rect.top + rect.height / 2 - tooltipHeight / 2;
            left = rect.right + spacing;
            break;
        }

        // Keep tooltip within viewport
        const padding = 10;
        top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding));
        left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding));

        setTooltipPosition({ top, left });
      } else {
        setTargetRect(null);
      }
    };

    updateTargetPosition();

    // Update on scroll or resize
    window.addEventListener("scroll", updateTargetPosition, true);
    window.addEventListener("resize", updateTargetPosition);

    // Watch for DOM changes
    observerRef.current = new MutationObserver(updateTargetPosition);
    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    return () => {
      window.removeEventListener("scroll", updateTargetPosition, true);
      window.removeEventListener("resize", updateTargetPosition);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [currentStep, isActive]);

  const handleNext = () => {
    if (currentStep < onboardingSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = () => {
    localStorage.setItem("hasSeenInteractiveOnboarding", "true");
    setIsActive(false);
  };

  const resetAndShow = () => {
    localStorage.removeItem("hasSeenInteractiveOnboarding");
    setCurrentStep(0);
    setIsActive(true);
  };

  // Expose reset function globally for help button
  useEffect(() => {
    (window as any).resetOnboarding = resetAndShow;
    return () => {
      delete (window as any).resetOnboarding;
    };
  }, []);

  if (!isActive || !targetRect) return null;

  const step = onboardingSteps[currentStep];

  return (
    <>
      {/* Overlay with spotlight effect */}
      <div 
        className="fixed inset-0 z-[9998] pointer-events-none"
        style={{
          background: 'transparent'
        }}
      >
        {/* Spotlight using box-shadow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6), 0 0 0 4px hsl(var(--primary) / 0.5)',
            borderRadius: '0.5rem',
            zIndex: 9998,
          }}
        />
      </div>

      {/* Tooltip */}
      <Card
        className="fixed z-[9999] w-[380px] shadow-2xl"
        style={{
          top: tooltipPosition.top,
          left: tooltipPosition.left,
        }}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{step.title}</CardTitle>
              <CardDescription className="mt-1.5">
                {step.description}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 -mt-1"
              onClick={handleSkip}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {onboardingSteps.map((_, index) => (
                <div
                  key={index}
                  className={`h-1.5 rounded-full transition-all ${
                    index === currentStep
                      ? "bg-primary w-8"
                      : index < currentStep
                      ? "bg-primary/50 w-1.5"
                      : "bg-muted w-1.5"
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleSkip}>
                Пропустить
              </Button>
              <Button size="sm" onClick={handleNext}>
                {currentStep < onboardingSteps.length - 1 ? (
                  <>
                    Далее
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </>
                ) : (
                  "Готово"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
