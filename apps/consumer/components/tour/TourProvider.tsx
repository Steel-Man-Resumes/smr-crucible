"use client";

/**
 * Tour Context Provider
 *
 * Manages tour state: current stop, navigation, explore mode.
 * Wraps the real app — the tour is an overlay, not a replacement.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { TOUR_STOPS, type TourStop } from "@/lib/tour-stops";

interface TourContextValue {
  isTouring: boolean;
  currentStop: TourStop | null;
  currentIndex: number;
  totalStops: number;
  exploring: boolean;
  advance: () => void;
  goBack: () => void;
  goToStop: (index: number) => void;
  toggleExplore: () => void;
  endTour: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour() {
  return useContext(TourContext);
}

export function TourProvider({
  children,
  startIndex = 0,
}: {
  children: ReactNode;
  startIndex?: number;
}) {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [exploring, setExploring] = useState(false);
  const [isTouring, setIsTouring] = useState(true);

  const currentStop = TOUR_STOPS[currentIndex] ?? null;

  const navigateToStop = useCallback(
    (index: number) => {
      const stop = TOUR_STOPS[index];
      if (stop) {
        router.push(stop.page);
      }
    },
    [router]
  );

  const advance = useCallback(() => {
    if (currentIndex < TOUR_STOPS.length - 1) {
      const next = currentIndex + 1;
      setCurrentIndex(next);
      setExploring(false);
      navigateToStop(next);
    }
  }, [currentIndex, navigateToStop]);

  const goBack = useCallback(() => {
    if (currentIndex > 0) {
      const prev = currentIndex - 1;
      setCurrentIndex(prev);
      setExploring(false);
      navigateToStop(prev);
    }
  }, [currentIndex, navigateToStop]);

  const goToStop = useCallback(
    (index: number) => {
      if (index >= 0 && index < TOUR_STOPS.length) {
        setCurrentIndex(index);
        setExploring(false);
        navigateToStop(index);
      }
    },
    [navigateToStop]
  );

  const toggleExplore = useCallback(() => {
    setExploring((prev) => !prev);
  }, []);

  const endTour = useCallback(() => {
    setIsTouring(false);
    router.push("/intro");
  }, [router]);

  return (
    <TourContext.Provider
      value={{
        isTouring,
        currentStop,
        currentIndex,
        totalStops: TOUR_STOPS.length,
        exploring,
        advance,
        goBack,
        goToStop,
        toggleExplore,
        endTour,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}
