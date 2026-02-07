// ============ Anki-Style Spaced Repetition System ============
// Based on SM-2 algorithm with learning steps like Anki/RemNote

// Card States
const CardState = {
  NEW: 0,        // Never studied
  LEARNING: 1,   // In learning phase (short intervals)
  REVIEW: 2,     // Graduated, normal review
  RELEARNING: 3  // Lapsed, back to learning
};

// Quality ratings (like Anki)
const Quality = {
  AGAIN: 1,  // Complete failure, reset
  HARD: 2,   // Correct but with difficulty
  GOOD: 3,   // Correct with some effort
  EASY: 4    // Perfect, trivial
};

// Learning steps in minutes
const LEARNING_STEPS = [1, 10];  // 1 min, 10 min, then graduate
const RELEARNING_STEPS = [10];   // 10 min for relearning
const GRADUATING_INTERVAL = 1;   // 1 day after graduating
const EASY_INTERVAL = 4;         // 4 days for Easy on new card
const MINIMUM_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const EASY_BONUS = 1.3;
const HARD_MULTIPLIER = 1.2;
const INTERVAL_MODIFIER = 1.0;

class AnkiSRS {
  constructor() {
    this.loadData();
  }

  loadData() {
    this.cards = JSON.parse(localStorage.getItem('english-anki-cards') || '{}');
    this.reviewLog = JSON.parse(localStorage.getItem('english-anki-log') || '[]');
    this.settings = JSON.parse(localStorage.getItem('english-anki-settings') || '{}');

    // Default settings
    this.settings.newCardsPerDay = this.settings.newCardsPerDay || 20;
    this.settings.maxReviewsPerDay = this.settings.maxReviewsPerDay || 200;
    this.settings.showAnswerTimer = this.settings.showAnswerTimer ?? true;
  }

  saveData() {
    localStorage.setItem('english-anki-cards', JSON.stringify(this.cards));
    localStorage.setItem('english-anki-log', JSON.stringify(this.reviewLog));
    localStorage.setItem('english-anki-settings', JSON.stringify(this.settings));
  }

  // Get today's date at midnight
  getToday() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }

  // Get current timestamp
  getNow() {
    return Date.now();
  }

  // ==========================================
  // Card Management
  // ==========================================

  // Initialize a new card
  initCard(wordId, wordData) {
    if (!this.cards[wordId]) {
      this.cards[wordId] = {
        id: wordId,
        word: wordData.en,
        data: wordData,
        state: CardState.NEW,
        due: this.getToday(),
        interval: 0,
        ease: DEFAULT_EASE,
        reps: 0,
        lapses: 0,
        step: 0,  // Current learning step
        lastReview: null,
        created: this.getNow()
      };
      this.saveData();
    }
    return this.cards[wordId];
  }

  // Get or create card
  getCard(wordId, wordData) {
    if (!this.cards[wordId] && wordData) {
      return this.initCard(wordId, wordData);
    }
    return this.cards[wordId];
  }

  // ==========================================
  // Queue Management
  // ==========================================

  // Get all cards due for review (learning + review)
  getDueCards() {
    const now = this.getNow();
    const today = this.getToday();
    const due = [];

    for (const card of Object.values(this.cards)) {
      if (card.state === CardState.NEW) continue;

      if (card.state === CardState.LEARNING || card.state === CardState.RELEARNING) {
        // Learning cards: check minute-based due time
        if (card.due <= now) {
          due.push({ ...card, priority: 0 }); // Learning first
        }
      } else if (card.state === CardState.REVIEW) {
        // Review cards: check day-based due time
        if (card.due <= today) {
          const overdue = Math.floor((today - card.due) / 86400000);
          due.push({ ...card, priority: 1, overdue });
        }
      }
    }

    // Sort: learning first, then by overdue days
    return due.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (b.overdue || 0) - (a.overdue || 0);
    });
  }

  // Get new cards (not yet studied)
  getNewCards(limit = null) {
    const newCards = Object.values(this.cards)
      .filter(c => c.state === CardState.NEW)
      .sort((a, b) => a.created - b.created);

    if (limit !== null) {
      return newCards.slice(0, limit);
    }
    return newCards;
  }

  // Get today's new cards remaining
  getNewCardsRemaining() {
    const todayStudied = this.getTodayStats().newCards || 0;
    const remaining = Math.max(0, this.settings.newCardsPerDay - todayStudied);
    return remaining;
  }

  // Get review queue for today
  getReviewQueue() {
    const dueCards = this.getDueCards();
    const newRemaining = this.getNewCardsRemaining();
    const newCards = this.getNewCards(newRemaining);

    // Interleave: some new cards mixed with reviews
    const queue = [];
    let newIndex = 0;

    for (let i = 0; i < dueCards.length; i++) {
      queue.push(dueCards[i]);

      // Add a new card every 10 reviews
      if (i > 0 && i % 10 === 0 && newIndex < newCards.length) {
        queue.push(newCards[newIndex++]);
      }
    }

    // Add remaining new cards
    while (newIndex < newCards.length) {
      queue.push(newCards[newIndex++]);
    }

    return queue;
  }

  // ==========================================
  // SM-2 Algorithm
  // ==========================================

  // Process a review answer
  answerCard(wordId, quality) {
    const card = this.cards[wordId];
    if (!card) return null;

    const now = this.getNow();
    const today = this.getToday();

    // Log the review
    this.reviewLog.push({
      cardId: wordId,
      quality,
      state: card.state,
      ease: card.ease,
      interval: card.interval,
      time: now
    });

    // Keep only last 10000 reviews
    if (this.reviewLog.length > 10000) {
      this.reviewLog = this.reviewLog.slice(-10000);
    }

    // Handle based on current state
    switch (card.state) {
      case CardState.NEW:
        this.handleNewCard(card, quality, now, today);
        break;
      case CardState.LEARNING:
        this.handleLearningCard(card, quality, now, today, LEARNING_STEPS);
        break;
      case CardState.RELEARNING:
        this.handleLearningCard(card, quality, now, today, RELEARNING_STEPS);
        break;
      case CardState.REVIEW:
        this.handleReviewCard(card, quality, now, today);
        break;
    }

    card.lastReview = now;
    card.reps++;
    this.saveData();

    return card;
  }

  handleNewCard(card, quality, now, today) {
    if (quality === Quality.EASY) {
      // Easy: graduate immediately with bonus interval
      card.state = CardState.REVIEW;
      card.interval = EASY_INTERVAL;
      card.due = today + card.interval * 86400000;
      card.ease = DEFAULT_EASE + 0.15; // Bonus ease
    } else if (quality === Quality.AGAIN) {
      // Again: start learning
      card.state = CardState.LEARNING;
      card.step = 0;
      card.due = now + LEARNING_STEPS[0] * 60000;
    } else {
      // Good/Hard: start learning but skip first step
      card.state = CardState.LEARNING;
      card.step = quality === Quality.GOOD ? 1 : 0;
      const stepMinutes = LEARNING_STEPS[Math.min(card.step, LEARNING_STEPS.length - 1)];
      card.due = now + stepMinutes * 60000;
    }

    // Update today's new card count
    this.incrementTodayStat('newCards');
  }

  handleLearningCard(card, quality, now, today, steps) {
    if (quality === Quality.AGAIN) {
      // Again: reset to first step
      card.step = 0;
      card.due = now + steps[0] * 60000;
    } else if (quality === Quality.EASY) {
      // Easy: graduate immediately
      this.graduateCard(card, today, true);
    } else {
      // Good/Hard: advance step
      card.step++;

      if (card.step >= steps.length) {
        // Finished learning, graduate
        this.graduateCard(card, today, false);
      } else {
        // Next learning step
        card.due = now + steps[card.step] * 60000;
      }
    }
  }

  graduateCard(card, today, isEasy) {
    const wasRelearning = card.state === CardState.RELEARNING;
    card.state = CardState.REVIEW;
    card.step = 0;

    if (wasRelearning) {
      // Relearning: use a fraction of the old interval
      card.interval = Math.max(1, Math.round(card.interval * 0.5));
    } else {
      // New card graduating
      card.interval = isEasy ? EASY_INTERVAL : GRADUATING_INTERVAL;
    }

    card.due = today + card.interval * 86400000;
  }

  handleReviewCard(card, quality, now, today) {
    // Update ease factor
    if (quality === Quality.AGAIN) {
      card.ease = Math.max(MINIMUM_EASE, card.ease - 0.2);
      card.lapses++;
      card.state = CardState.RELEARNING;
      card.step = 0;
      card.due = now + RELEARNING_STEPS[0] * 60000;
      this.incrementTodayStat('lapses');
    } else {
      // Calculate new interval
      let intervalMultiplier;

      if (quality === Quality.HARD) {
        intervalMultiplier = HARD_MULTIPLIER;
        card.ease = Math.max(MINIMUM_EASE, card.ease - 0.15);
      } else if (quality === Quality.GOOD) {
        intervalMultiplier = card.ease;
      } else { // EASY
        intervalMultiplier = card.ease * EASY_BONUS;
        card.ease += 0.15;
      }

      // Calculate new interval with some fuzz
      let newInterval = card.interval * intervalMultiplier * INTERVAL_MODIFIER;
      newInterval = Math.max(card.interval + 1, Math.round(newInterval));

      // Add some randomness (±5%)
      const fuzz = Math.round(newInterval * 0.05);
      newInterval += Math.floor(Math.random() * (fuzz * 2 + 1)) - fuzz;

      card.interval = Math.max(1, newInterval);
      card.due = today + card.interval * 86400000;
    }

    this.incrementTodayStat('reviews');
  }

  // ==========================================
  // Statistics
  // ==========================================

  incrementTodayStat(key) {
    const today = new Date().toISOString().split('T')[0];
    const stats = JSON.parse(localStorage.getItem('english-anki-daily') || '{}');

    if (!stats[today]) {
      stats[today] = { newCards: 0, reviews: 0, lapses: 0, time: 0 };
    }

    stats[today][key] = (stats[today][key] || 0) + 1;
    localStorage.setItem('english-anki-daily', JSON.stringify(stats));
  }

  getTodayStats() {
    const today = new Date().toISOString().split('T')[0];
    const stats = JSON.parse(localStorage.getItem('english-anki-daily') || '{}');
    return stats[today] || { newCards: 0, reviews: 0, lapses: 0, time: 0 };
  }

  getOverallStats() {
    const cards = Object.values(this.cards);
    const stats = {
      total: cards.length,
      new: cards.filter(c => c.state === CardState.NEW).length,
      learning: cards.filter(c => c.state === CardState.LEARNING || c.state === CardState.RELEARNING).length,
      review: cards.filter(c => c.state === CardState.REVIEW).length,
      mature: cards.filter(c => c.state === CardState.REVIEW && c.interval >= 21).length,
      totalReviews: cards.reduce((sum, c) => sum + c.reps, 0),
      totalLapses: cards.reduce((sum, c) => sum + c.lapses, 0)
    };

    // Calculate retention rate
    if (stats.totalReviews > 0) {
      stats.retention = Math.round((1 - stats.totalLapses / stats.totalReviews) * 100);
    } else {
      stats.retention = 0;
    }

    // Due today
    stats.dueToday = this.getDueCards().length;
    stats.newRemaining = this.getNewCardsRemaining();

    return stats;
  }

  // Get forecast for next 30 days
  getForecast(days = 30) {
    const forecast = [];
    const today = this.getToday();

    for (let i = 0; i < days; i++) {
      const day = today + i * 86400000;
      const due = Object.values(this.cards).filter(c => {
        if (c.state !== CardState.REVIEW) return false;
        const cardDue = new Date(c.due);
        cardDue.setHours(0, 0, 0, 0);
        return cardDue.getTime() === day;
      }).length;

      forecast.push({
        date: new Date(day).toISOString().split('T')[0],
        due
      });
    }

    return forecast;
  }

  // Get interval distribution
  getIntervalDistribution() {
    const dist = { '1d': 0, '1w': 0, '1m': 0, '3m': 0, '6m+': 0 };

    for (const card of Object.values(this.cards)) {
      if (card.state !== CardState.REVIEW) continue;

      if (card.interval <= 1) dist['1d']++;
      else if (card.interval <= 7) dist['1w']++;
      else if (card.interval <= 30) dist['1m']++;
      else if (card.interval <= 90) dist['3m']++;
      else dist['6m+']++;
    }

    return dist;
  }

  // Get next interval preview for each quality
  getNextIntervals(wordId) {
    const card = this.cards[wordId];
    if (!card) return null;

    const intervals = {};
    const now = this.getNow();

    if (card.state === CardState.NEW) {
      intervals[Quality.AGAIN] = '1m';
      intervals[Quality.HARD] = '1m';
      intervals[Quality.GOOD] = '10m';
      intervals[Quality.EASY] = `${EASY_INTERVAL}d`;
    } else if (card.state === CardState.LEARNING || card.state === CardState.RELEARNING) {
      const steps = card.state === CardState.LEARNING ? LEARNING_STEPS : RELEARNING_STEPS;
      intervals[Quality.AGAIN] = `${steps[0]}m`;

      if (card.step + 1 >= steps.length) {
        const gradInterval = card.state === CardState.RELEARNING
          ? Math.max(1, Math.round(card.interval * 0.5))
          : GRADUATING_INTERVAL;
        intervals[Quality.GOOD] = `${gradInterval}d`;
      } else {
        intervals[Quality.GOOD] = `${steps[card.step + 1]}m`;
      }

      intervals[Quality.EASY] = `${EASY_INTERVAL}d`;
    } else {
      // Review card
      intervals[Quality.AGAIN] = `${RELEARNING_STEPS[0]}m`;
      intervals[Quality.HARD] = `${Math.round(card.interval * HARD_MULTIPLIER)}d`;
      intervals[Quality.GOOD] = `${Math.round(card.interval * card.ease)}d`;
      intervals[Quality.EASY] = `${Math.round(card.interval * card.ease * EASY_BONUS)}d`;
    }

    return intervals;
  }
}

// Create global instance
const ankiSRS = new AnkiSRS();

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AnkiSRS, ankiSRS, CardState, Quality };
}
