export class AudioService {
  constructor() {
    this.context = null
    this.enabled = true
    this.initAudioContext()
  }

  initAudioContext() {
    try {
      // Create AudioContext on first user interaction
      this.context = new (window.AudioContext || window.webkitAudioContext)()
    } catch (error) {
      console.warn('Web Audio API not supported:', error)
      this.enabled = false
    }
  }

  async resumeAudioContext() {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume()
    }
  }

  // Create a beep sound using Web Audio API
  playBeep(frequency = 800, duration = 200, volume = 0.3) {
    if (!this.enabled || !this.context) return

    try {
      this.resumeAudioContext()

      const oscillator = this.context.createOscillator()
      const gainNode = this.context.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(this.context.destination)

      oscillator.frequency.value = frequency
      oscillator.type = 'sine'

      gainNode.gain.setValueAtTime(0, this.context.currentTime)
      gainNode.gain.linearRampToValueAtTime(volume, this.context.currentTime + 0.01)
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration / 1000)

      oscillator.start(this.context.currentTime)
      oscillator.stop(this.context.currentTime + duration / 1000)
    } catch (error) {
      console.warn('Error playing beep:', error)
    }
  }

  // Timer warning beep (lower pitch)
  playTimerWarning() {
    this.playBeep(600, 300, 0.2)
  }

  // Timer urgent beep (higher pitch, shorter)
  playTimerUrgent() {
    this.playBeep(1000, 150, 0.3)
  }

  // Tada sound for player nominations
  playTadaSound() {
    if (!this.enabled || !this.context) return

    try {
      this.resumeAudioContext()

      // Create a triumphant "tada" sound with ascending notes
      const frequencies = [261.63, 329.63, 392.00, 523.25] // C4, E4, G4, C5 (major chord progression)
      const baseTime = this.context.currentTime

      frequencies.forEach((freq, index) => {
        const oscillator = this.context.createOscillator()
        const gainNode = this.context.createGain()

        oscillator.connect(gainNode)
        gainNode.connect(this.context.destination)

        oscillator.frequency.value = freq
        oscillator.type = 'triangle'

        const startTime = baseTime + (index * 0.15) // Stagger notes for melody
        const duration = 0.4

        gainNode.gain.setValueAtTime(0, startTime)
        gainNode.gain.linearRampToValueAtTime(0.12, startTime + 0.02)
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

        oscillator.start(startTime)
        oscillator.stop(startTime + duration)
      })

      // Add a bell-like flourish at the end
      setTimeout(() => {
        const oscillator = this.context.createOscillator()
        const gainNode = this.context.createGain()

        oscillator.connect(gainNode)
        gainNode.connect(this.context.destination)

        oscillator.frequency.value = 1046.5 // C6
        oscillator.type = 'sine'

        const startTime = this.context.currentTime
        const duration = 0.6

        gainNode.gain.setValueAtTime(0, startTime)
        gainNode.gain.linearRampToValueAtTime(0.08, startTime + 0.01)
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

        oscillator.start(startTime)
        oscillator.stop(startTime + duration)
      }, 500)

    } catch (error) {
      console.warn('Error playing tada sound:', error)
    }
  }

  // Cha-ching sound effect for winning bids
  playChaChingSound() {
    if (!this.enabled || !this.context) return

    try {
      this.resumeAudioContext()

      // Create a more complex "cha-ching" sound with multiple frequencies
      const frequencies = [523.25, 659.25, 783.99] // C5, E5, G5 (major chord)
      const baseTime = this.context.currentTime

      frequencies.forEach((freq, index) => {
        const oscillator = this.context.createOscillator()
        const gainNode = this.context.createGain()

        oscillator.connect(gainNode)
        gainNode.connect(this.context.destination)

        oscillator.frequency.value = freq
        oscillator.type = 'sine'

        const startTime = baseTime + (index * 0.1) // Stagger the notes
        const duration = 0.6

        gainNode.gain.setValueAtTime(0, startTime)
        gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.01)
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

        oscillator.start(startTime)
        oscillator.stop(startTime + duration)
      })

      // Add a bell-like resonance
      setTimeout(() => {
        const oscillator = this.context.createOscillator()
        const gainNode = this.context.createGain()

        oscillator.connect(gainNode)
        gainNode.connect(this.context.destination)

        oscillator.frequency.value = 1046.5 // C6
        oscillator.type = 'triangle'

        const startTime = this.context.currentTime
        const duration = 0.8

        gainNode.gain.setValueAtTime(0, startTime)
        gainNode.gain.linearRampToValueAtTime(0.1, startTime + 0.01)
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

        oscillator.start(startTime)
        oscillator.stop(startTime + duration)
      }, 200)

    } catch (error) {
      console.warn('Error playing cha-ching sound:', error)
    }
  }

  // Toggle audio on/off
  toggleAudio() {
    this.enabled = !this.enabled
    return this.enabled
  }

  // Initialize audio context on first user interaction
  handleUserInteraction() {
    if (!this.context) {
      this.initAudioContext()
    }
    this.resumeAudioContext()
  }
}

// Create singleton instance
export const audioService = new AudioService()

// Initialize audio context on first user interaction
document.addEventListener('click', () => {
  audioService.handleUserInteraction()
}, { once: true })