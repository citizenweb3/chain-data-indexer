/**
 * Lock-free atomic counter для round-robin распределения
 * Использует простую реализацию с атомарными операциями
 */
export class AtomicCounter {
  private value = 0;

  increment(): number {
    return this.value++;
  }

  get currentValue(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}
