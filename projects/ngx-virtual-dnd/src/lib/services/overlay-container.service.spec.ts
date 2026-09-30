import { TestBed } from '@angular/core/testing';
import { OverlayContainerService } from './overlay-container.service';

describe('OverlayContainerService', () => {
  let service: OverlayContainerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OverlayContainerService);
  });

  describe('hasTemplatePreview', () => {
    it('is false with no registered template previews', () => {
      expect(service.hasTemplatePreview()).toBe(false);
    });

    it('becomes true while at least one template preview is registered', () => {
      service.setTemplatePreviewActive(true);
      expect(service.hasTemplatePreview()).toBe(true);

      service.setTemplatePreviewActive(false);
      expect(service.hasTemplatePreview()).toBe(false);
    });

    it('stays true until every registered preview is unregistered (balanced counter)', () => {
      service.setTemplatePreviewActive(true);
      service.setTemplatePreviewActive(true);
      expect(service.hasTemplatePreview()).toBe(true);

      service.setTemplatePreviewActive(false);
      expect(service.hasTemplatePreview()).toBe(true);

      service.setTemplatePreviewActive(false);
      expect(service.hasTemplatePreview()).toBe(false);
    });

    it('never drops below zero on an unbalanced unregister', () => {
      service.setTemplatePreviewActive(false);
      expect(service.hasTemplatePreview()).toBe(false);

      service.setTemplatePreviewActive(true);
      expect(service.hasTemplatePreview()).toBe(true);
    });
  });

  describe('hasClonePreview', () => {
    it('is false with no mounted preview', () => {
      expect(service.hasClonePreview()).toBe(false);
    });

    it('is true while a mounted preview has no template', () => {
      service.setPreviewMounted(true);
      expect(service.hasClonePreview()).toBe(true);

      service.setPreviewMounted(false);
      expect(service.hasClonePreview()).toBe(false);
    });

    it('is false while every mounted preview renders a template', () => {
      service.setPreviewMounted(true);
      service.setTemplatePreviewActive(true);

      expect(service.hasClonePreview()).toBe(false);
    });

    it('is true while one of several mounted previews has no template', () => {
      service.setPreviewMounted(true);
      service.setPreviewMounted(true);
      service.setTemplatePreviewActive(true);

      expect(service.hasClonePreview()).toBe(true);
    });

    it('never drops below zero on an unbalanced unmount', () => {
      service.setPreviewMounted(false);
      service.setPreviewMounted(true);

      expect(service.hasClonePreview()).toBe(true);
    });
  });
});
