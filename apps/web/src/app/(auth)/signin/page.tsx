import { Suspense } from 'react'
import { SignInForm } from './signin-form'

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-white">Coriven</h1>
          <p className="text-gray-400 mt-1 text-sm">Sign in to continue</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <Suspense>
            <SignInForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
