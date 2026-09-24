import { Component, signal, TemplateRef, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PlaceholderComponent, PlaceholderContext } from './placeholder.component';

@Component({
  template: `<vdnd-placeholder [height]="height()" />`,
  imports: [PlaceholderComponent],
})
class TestHostComponent {
  height = signal(75);
}

@Component({
  template: `<vdnd-placeholder />`,
  imports: [PlaceholderComponent],
})
class TestHostWithoutHeightComponent {}

@Component({
  template: `
    <vdnd-placeholder [height]="height()" [template]="customTpl()">
      <ng-template #placeholderTpl let-h>
        <div class="custom-placeholder" [style.height.px]="h">Custom Content</div>
      </ng-template>
    </vdnd-placeholder>
  `,
  imports: [PlaceholderComponent],
})
class TestHostWithTemplateComponent {
  height = signal(50);
  private readonly templateRef = viewChild<TemplateRef<PlaceholderContext>>('placeholderTpl');
  customTpl = signal<TemplateRef<PlaceholderContext> | undefined>(undefined);

  enableCustomTemplate(): void {
    this.customTpl.set(this.templateRef());
  }

  disableCustomTemplate(): void {
    this.customTpl.set(undefined);
  }
}

describe('PlaceholderComponent', () => {
  describe('default behavior (transparent)', () => {
    let fixture: ComponentFixture<TestHostComponent>;
    let component: TestHostComponent;
    let placeholderEl: HTMLElement;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [TestHostComponent, TestHostWithoutHeightComponent],
      });

      fixture = TestBed.createComponent(TestHostComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      const placeholderDebug = fixture.debugElement.query(By.directive(PlaceholderComponent));
      placeholderEl = placeholderDebug.nativeElement;
    });

    afterEach(() => {
      fixture.destroy();
    });

    it('should have vdnd-placeholder class', () => {
      expect(placeholderEl.classList.contains('vdnd-placeholder')).toBe(true);
    });

    it('should have data-draggable-id attribute set to placeholder', () => {
      expect(placeholderEl.getAttribute('data-draggable-id')).toBe('placeholder');
    });

    it('should render transparent (empty) by default', () => {
      // The placeholder should have no visible inner content by default
      expect(placeholderEl.children.length).toBe(0);
    });

    it('should use the height input', () => {
      expect(placeholderEl.style.height).toBe('75px');
    });

    it('should update height when input changes', () => {
      component.height.set(120);
      fixture.detectChanges();

      expect(placeholderEl.style.height).toBe('120px');
    });

    it('should default to 50px when no height is bound', () => {
      const defaultFixture = TestBed.createComponent(TestHostWithoutHeightComponent);
      defaultFixture.detectChanges();

      const defaultEl = defaultFixture.debugElement.query(By.directive(PlaceholderComponent))
        .nativeElement as HTMLElement;
      expect(defaultEl.style.height).toBe('50px');

      defaultFixture.destroy();
    });
  });

  describe('custom template', () => {
    let fixture: ComponentFixture<TestHostWithTemplateComponent>;
    let component: TestHostWithTemplateComponent;
    let placeholderEl: HTMLElement;

    beforeEach(() => {
      TestBed.configureTestingModule({
        imports: [TestHostWithTemplateComponent],
      });

      fixture = TestBed.createComponent(TestHostWithTemplateComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      const placeholderDebug = fixture.debugElement.query(By.directive(PlaceholderComponent));
      placeholderEl = placeholderDebug.nativeElement;
    });

    afterEach(() => {
      fixture.destroy();
    });

    it('should not render template content when template is undefined', () => {
      expect(placeholderEl.children.length).toBe(0);
      const customContent = fixture.debugElement.query(By.css('.custom-placeholder'));
      expect(customContent).toBeNull();
    });

    it('should render custom template content when template is provided', () => {
      component.enableCustomTemplate();
      fixture.detectChanges();

      const customContent = fixture.debugElement.query(By.css('.custom-placeholder'));
      expect(customContent).not.toBeNull();
      expect(customContent.nativeElement.textContent).toContain('Custom Content');
    });

    it('should pass height to template context', () => {
      component.height.set(75);
      component.enableCustomTemplate();
      fixture.detectChanges();

      const customContent = fixture.debugElement.query(By.css('.custom-placeholder'));
      expect(customContent.nativeElement.style.height).toBe('75px');
    });

    it('should switch between transparent and custom template', () => {
      // Start with no template (transparent)
      expect(placeholderEl.children.length).toBe(0);

      // Enable custom template
      component.enableCustomTemplate();
      fixture.detectChanges();
      let customContent = fixture.debugElement.query(By.css('.custom-placeholder'));
      expect(customContent).not.toBeNull();

      // Disable custom template (back to transparent)
      component.disableCustomTemplate();
      fixture.detectChanges();
      customContent = fixture.debugElement.query(By.css('.custom-placeholder'));
      expect(customContent).toBeNull();
    });
  });
});
