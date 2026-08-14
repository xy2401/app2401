import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

type LocationState = {
  pathname: string;
  search: string;
  hash: string;
};

function readLocation(): LocationState {
  if (typeof window === "undefined") return { pathname: "/", search: "", hash: "" };
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

export function useLocation(): LocationState {
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return location;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
};

export function Link({ href, onClick, target, download, ...props }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target ||
      download
    ) return;
    const next = new URL(href, window.location.href);
    if (next.origin !== window.location.origin) return;
    event.preventDefault();
    window.history.pushState({}, "", `${next.pathname}${next.search}${next.hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  return <a href={href} target={target} download={download} onClick={handleClick} {...props} />;
}
