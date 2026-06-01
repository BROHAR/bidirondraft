export class TimerService {
  constructor() {
    this.timers = new Map()
    this.callbacks = new Map()
  }

  startTimer(id, duration, onTick, onComplete) {
    // Clear existing timer if any
    this.stopTimer(id)
    
    let timeRemaining = duration
    this.callbacks.set(id, { onTick, onComplete })
    
    // Initial tick
    if (onTick) onTick(timeRemaining)
    
    const intervalId = setInterval(() => {
      timeRemaining--
      
      if (onTick) onTick(timeRemaining)
      
      if (timeRemaining <= 0) {
        this.stopTimer(id)
        if (onComplete) onComplete()
      }
    }, 1000)
    
    this.timers.set(id, {
      intervalId,
      startTime: Date.now(),
      duration,
      timeRemaining
    })
  }

  stopTimer(id) {
    const timer = this.timers.get(id)
    if (timer) {
      clearInterval(timer.intervalId)
      this.timers.delete(id)
      this.callbacks.delete(id)
    }
  }

  pauseTimer(id) {
    const timer = this.timers.get(id)
    if (timer) {
      clearInterval(timer.intervalId)
      // Keep timer data but stop the interval
      timer.pausedAt = Date.now()
    }
  }

  resumeTimer(id) {
    const timer = this.timers.get(id)
    const callbacks = this.callbacks.get(id)
    
    if (timer && timer.pausedAt && callbacks) {
      const { onTick, onComplete } = callbacks
      let timeRemaining = timer.timeRemaining
      
      const intervalId = setInterval(() => {
        timeRemaining--
        timer.timeRemaining = timeRemaining
        
        if (onTick) onTick(timeRemaining)
        
        if (timeRemaining <= 0) {
          this.stopTimer(id)
          if (onComplete) onComplete()
        }
      }, 1000)
      
      timer.intervalId = intervalId
      delete timer.pausedAt
    }
  }

  extendTimer(id, additionalTime) {
    const timer = this.timers.get(id)
    if (timer) {
      timer.timeRemaining += additionalTime
      timer.duration += additionalTime
    }
  }

  getRemainingTime(id) {
    const timer = this.timers.get(id)
    return timer ? timer.timeRemaining : 0
  }

  isActive(id) {
    return this.timers.has(id) && !this.timers.get(id).pausedAt
  }

  stopAllTimers() {
    for (const [id] of this.timers) {
      this.stopTimer(id)
    }
  }
}

// Create singleton instance
export const timerService = new TimerService()