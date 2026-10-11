// A server page that hands a function to an element: what broke the signed-in
// security page (review r2, N1). The RSC check must refuse it.
export default function HandlerPage() {
  return <button onClick={() => {}}>Go</button>;
}
