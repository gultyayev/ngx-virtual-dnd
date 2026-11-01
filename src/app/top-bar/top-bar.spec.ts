import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TopBarComponent } from './top-bar';

@Component({ template: '' })
class BlankPageComponent {}

describe('TopBarComponent', () => {
  /** Labels of the links in `root` that carry the current-tab class. */
  const currentTabs = (root: ParentNode, selector: string): string[] =>
    Array.from(root.querySelectorAll<HTMLAnchorElement>(selector))
      .filter((link) => link.classList.contains('is-active'))
      .map((link) => link.textContent?.trim() ?? '');

  const render = async (url: string) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: BlankPageComponent },
          { path: 'page-scroll', component: BlankPageComponent },
          { path: 'dynamic-height', component: BlankPageComponent },
        ]),
      ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(TopBarComponent);
    await fixture.whenStable();
    return fixture;
  };

  afterEach(() => {
    // The open menu sheet is teleported to <body>, outside the fixture.
    document.querySelectorAll('.nav-menu').forEach((menu) => menu.remove());
    TestBed.resetTestingModule();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('marks Main demo current on /', async () => {
    const fixture = await render('/');

    expect(currentTabs(fixture.nativeElement, 'nav a')).toEqual(['Main demo']);
  });

  // The docs open the demo with ?theme=light|dark; a query must not change the current tab.
  it('keeps Main demo current when the URL carries a query', async () => {
    const fixture = await render('/?theme=dark');

    expect(currentTabs(fixture.nativeElement, 'nav a')).toEqual(['Main demo']);
  });

  it('keeps the other tabs current when the URL carries a query', async () => {
    const fixture = await render('/page-scroll?theme=light');

    expect(currentTabs(fixture.nativeElement, 'nav a')).toEqual(['Page scroll']);
  });

  it('marks Main demo current in the menu sheet when the URL carries a query', async () => {
    const fixture = await render('/?theme=light');

    fixture.componentInstance.toggleMenu();
    await fixture.whenStable();

    expect(currentTabs(document.body, '.nav-menu a')).toEqual(['Main demo']);
  });
});
